"""
SEFS Pipeline — orchestrates the full processing pipeline:
extract → embed → cluster → name → sync → notify.
"""

from __future__ import annotations
import asyncio
import logging
import numpy as np
from pathlib import Path
from datetime import datetime

from app.config import settings
from app import db, extractor, embedder, clusterer, namer, sync
from app.metrics import metrics as pipeline_metrics, Timer

logger = logging.getLogger("sefs.pipeline")

# WebSocket broadcast callback — set by main.py
_broadcast_fn = None


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


async def broadcast(event: dict):
    if _broadcast_fn:
        event.setdefault("timestamp", datetime.utcnow().isoformat())
        await _broadcast_fn(event)


async def _repair_file_records() -> tuple[int, int]:
    """
    Deduplicate stale DB rows (same content hash) and remove orphan records whose
    paths no longer exist on disk. Returns (dedup_removed, orphan_removed).
    """
    files = await db.get_all_files()
    if not files:
        return 0, 0

    dedup_removed = 0
    orphan_removed = 0

    by_hash: dict[str, list[db.FileRecord]] = {}
    for f in files:
        by_hash.setdefault(f.content_hash, []).append(f)

    # Remove duplicate rows created by manual moves + stale path records.
    # We only dedupe within same (hash, filename) and when some entries are stale.
    for content_hash, group in by_hash.items():
        if len(group) < 2:
            continue
        by_name: dict[str, list[db.FileRecord]] = {}
        for rec in group:
            by_name.setdefault(rec.filename, []).append(rec)

        for filename, same_name in by_name.items():
            if len(same_name) < 2:
                continue

            stale = []
            for rec in same_name:
                current_exists = (
                    bool(rec.current_path) and Path(rec.current_path).exists()
                )
                original_exists = (
                    bool(rec.original_path) and Path(rec.original_path).exists()
                )
                if not current_exists and not original_exists:
                    stale.append(rec)
                elif not current_exists:
                    stale.append(rec)

            if not stale:
                continue

            def score(rec: db.FileRecord) -> tuple[int, int]:
                current_exists = (
                    1 if rec.current_path and Path(rec.current_path).exists() else 0
                )
                original_exists = (
                    1 if rec.original_path and Path(rec.original_path).exists() else 0
                )
                return (current_exists * 2 + original_exists, rec.id)

            keeper = max(same_name, key=score)
            for rec in stale:
                if rec.id == keeper.id:
                    continue
                await db.delete_file_by_id(rec.id)
                dedup_removed += 1
                logger.warning(
                    f"Removed stale duplicate id={rec.id} "
                    f"filename={filename} hash={content_hash[:8]}"
                )

    # Remove records whose current/original file paths are both gone.
    files_after = await db.get_all_files()
    for f in files_after:
        current_exists = bool(f.current_path) and Path(f.current_path).exists()
        original_exists = bool(f.original_path) and Path(f.original_path).exists()
        if not current_exists and not original_exists:
            await db.delete_file_by_id(f.id)
            orphan_removed += 1
            logger.warning(f"Removed orphan record id={f.id} filename={f.filename}")

    if dedup_removed or orphan_removed:
        logger.info(
            f"Record repair complete: removed {dedup_removed} duplicates, "
            f"{orphan_removed} orphan rows"
        )
    return dedup_removed, orphan_removed


async def process_file(path: Path) -> int | None:
    """Process a single file: extract, embed, store. Returns file DB id."""
    if not path.exists() or not extractor.is_supported(path):
        return None

    logger.info(f"Processing file: {path.name}")
    await broadcast({"type": "processing_start", "filename": path.name})

    try:
        # Extract content
        with Timer() as t_extract:
            result = extractor.extract(path)
        pipeline_metrics.record_extraction(t_extract.elapsed_ms)

        if not result.text.strip():
            logger.warning(f"No text extracted from {path.name}")
            return None

        # Check if already processed with same hash
        existing = await db.get_file_by_path(str(path))
        if existing and existing.content_hash == result.content_hash:
            # File may be moved manually in Finder; keep DB path/filename in sync
            # even when content hash is unchanged.
            path_changed = existing.current_path != str(path)
            name_changed = existing.filename != path.name
            if path_changed:
                await db.update_file_current_path(existing.id, str(path))
            if name_changed:
                await db.update_file_filename(existing.id, path.name)

            has_valid_embedding = (
                existing.embedding is not None
                and len(existing.embedding) > 0
                and np.any(existing.embedding)
            )
            if has_valid_embedding:
                if path_changed or name_changed:
                    logger.info(
                        f"File relocated without content change: {path.name} "
                        f"(path_changed={path_changed}, name_changed={name_changed})"
                    )
                else:
                    logger.info(f"File unchanged, skipping: {path.name}")
                return existing.id
            logger.info(
                f"File unchanged but embedding missing/zero, reprocessing: {path.name}"
            )
        elif not existing:
            # If path-based lookup misses but hash already exists, this is usually
            # the same file relocated by user; update the existing record instead
            # of inserting a duplicate row.
            hash_existing = await db.get_file_by_hash(result.content_hash)
            if hash_existing:
                now = datetime.utcnow().isoformat()
                await db.update_file_paths(
                    hash_existing.id,
                    original_path=str(path),
                    current_path=str(path),
                    filename=path.name,
                    modified_at=now,
                )
                await db.add_event(hash_existing.id, "file_modified", path.name)
                await broadcast(
                    {
                        "type": "file_modified",
                        "file_id": hash_existing.id,
                        "filename": path.name,
                        "file_type": result.file_type,
                        "word_count": result.word_count,
                        "summary": (hash_existing.summary or "")[:120],
                    }
                )
                logger.info(
                    f"Re-linked moved file to existing hash record: {path.name} "
                    f"(id={hash_existing.id})"
                )
                return hash_existing.id

        # Generate embedding
        async with Timer() as t_embed:
            embedding = await embedder.get_embedding(result.text)
        pipeline_metrics.record_embedding(t_embed.elapsed_ms)

        # Generate summary
        summary = await embedder.generate_summary(result.text)

        now = datetime.utcnow().isoformat()
        record = db.FileRecord(
            filename=path.name,
            original_path=str(path),
            current_path=str(path),
            content_hash=result.content_hash,
            embedding=embedding,
            summary=summary,
            file_type=result.file_type,
            size_bytes=result.size_bytes,
            word_count=result.word_count,
            page_count=result.page_count,
            created_at=existing.created_at if existing else now,
            modified_at=now,
        )

        file_id = await db.upsert_file(record)
        pipeline_metrics.total_files_processed += 1
        event_type = "file_modified" if existing else "file_added"
        await db.add_event(file_id, event_type, path.name)
        await broadcast(
            {
                "type": event_type,
                "file_id": file_id,
                "filename": path.name,
                "file_type": result.file_type,
                "word_count": result.word_count,
                "summary": (summary or "")[:120],
            }
        )

        logger.info(f"Processed {path.name} (id={file_id}, words={result.word_count})")
        return file_id

    except Exception as e:
        logger.error(f"Failed to process {path.name}: {e}", exc_info=True)
        return None


async def remove_file(path: Path):
    """Remove a file from the database.
    Guards against false deletions: if the same content hash exists at another
    valid path, the file was moved — not deleted."""
    existing = await db.get_file_by_path(str(path))
    if existing:
        # Check if another record with same hash still exists on disk
        hash_record = await db.get_file_by_hash(existing.content_hash)
        if hash_record and hash_record.id != existing.id:
            other_path = Path(hash_record.current_path or hash_record.original_path)
            if other_path.exists():
                logger.info(
                    f"Skipping delete for {path.name}: same content exists at {other_path.name}"
                )
                return
        # Also check if the file's current_path still exists (it may have been moved)
        if existing.current_path and existing.current_path != str(path):
            if Path(existing.current_path).exists():
                logger.info(
                    f"Skipping delete for {path.name}: file exists at current_path {existing.current_path}"
                )
                return
        await db.delete_file_by_path(str(path))
        await db.add_event(existing.id, "file_removed", path.name)
        await broadcast(
            {"type": "file_removed", "file_id": existing.id, "filename": path.name}
        )
        logger.info(f"Removed {path.name} from DB")


async def run_clustering():
    """Re-cluster all files and sync to OS folders."""
    await _repair_file_records()

    files = await db.get_all_files()
    if not files:
        logger.info("No files to cluster")
        return

    # Gather embeddings
    embeddings = []
    valid_files = []
    for f in files:
        if f.embedding is not None and np.any(f.embedding):
            embeddings.append(f.embedding)
            valid_files.append(f)

    if len(valid_files) < 2:
        if len(files) <= 1:
            logger.info("Single-file collection, creating General cluster")
            await db.clear_clusters()
            if valid_files:
                f = valid_files[0]
                await db.update_file_cluster(f.id, 0)
                await db.update_file_umap(f.id, 0.0, 0.0)
                await db.upsert_cluster(
                    db.ClusterRecord(
                        id=0,
                        name="General",
                        description="Single-file cluster",
                        folder_path=str(settings.root_path / "General"),
                        centroid=f.embedding,
                        file_count=1,
                        created_at=datetime.utcnow().isoformat(),
                    )
                )
                await broadcast(
                    {"type": "reclustering_end", "cluster_count": 1, "total_moves": 0}
                )
        else:
            logger.warning(
                "Not enough valid embeddings to recluster; preserving previous clustering"
            )
        return

    await broadcast({"type": "reclustering_start"})

    _cluster_start = __import__("time").perf_counter()

    # ── Normalize embedding dimensions ──
    # Different backends (Ollama=768, OpenAI=1536) may produce different dims.
    # Find the most common dimension and re-embed or resize outliers.
    dims = [e.shape[0] for e in embeddings]
    target_dim = embedder.get_expected_embedding_dim()
    if any(d != target_dim for d in dims):
        from collections import Counter

        dim_counts = Counter(dims)
        logger.warning(
            f"Embedding dimensions need alignment. current={dict(dim_counts)}, "
            f"target={target_dim} (provider={settings.selected_provider})."
        )
        for i, f in enumerate(valid_files):
            if dims[i] == target_dim:
                continue

            source_text = f.summary or f.filename
            try:
                src = Path(f.original_path)
                if src.exists() and extractor.is_supported(src):
                    extracted = extractor.extract(src).text
                    if extracted.strip():
                        source_text = extracted
            except (FileNotFoundError, OSError) as e:
                logger.warning(f"File gone during re-embed for {f.filename}: {e}")
            except Exception as e:
                logger.warning(f"Failed to read source for {f.filename}: {e}")

            try:
                new_emb = await embedder.get_embedding_matching_dim(
                    source_text, target_dim
                )
                if not np.any(new_emb):
                    raise ValueError("Got zero embedding from provider")
                embeddings[i] = new_emb
                await db.update_file_embedding(f.id, new_emb)
                logger.info(f"Re-embedded {f.filename} ({dims[i]}->{target_dim})")
            except Exception as e:
                logger.warning(f"Re-embedding failed for {f.filename}: {e}")
                if dims[i] < target_dim:
                    embeddings[i] = np.pad(
                        embeddings[i],
                        (0, target_dim - dims[i]),
                        mode="constant",
                        constant_values=0,
                    )
                else:
                    embeddings[i] = embeddings[i][:target_dim]
                logger.info(
                    f"Resized embedding for {f.filename} ({dims[i]}->{target_dim})"
                )

    # Drop zero vectors that can appear when provider credentials/model are unavailable.
    filtered_embeddings = []
    filtered_files = []
    for i, emb in enumerate(embeddings):
        if np.any(emb):
            filtered_embeddings.append(emb)
            filtered_files.append(valid_files[i])

    embeddings = filtered_embeddings
    valid_files = filtered_files
    if len(valid_files) < 2:
        logger.warning(
            "Not enough non-zero embeddings after alignment; preserving previous clustering"
        )
        return

    emb_matrix = np.vstack(embeddings)

    # Cluster
    labels, coords_2d = clusterer.cluster_embeddings(emb_matrix)
    centroids = clusterer.compute_centroids(emb_matrix, labels)

    # Scale coords for visualization (spread them out)
    if coords_2d.max() != coords_2d.min():
        coords_2d = (coords_2d - coords_2d.min()) / (coords_2d.max() - coords_2d.min())
        coords_2d = coords_2d * 800 - 400  # spread -400 to 400

    # Generate cluster names (compute everything first, then write atomically)
    unique_labels = sorted(set(labels))
    cluster_names = {}
    cluster_records = []

    for cid in unique_labels:
        if cid < 0:
            # Noise / uncategorised points — create a dedicated folder
            noise_count = int((labels == cid).sum())
            cluster_names[int(cid)] = "Uncategorised"
            cluster_records.append(
                db.ClusterRecord(
                    id=int(cid),
                    name="Uncategorised",
                    description=f"{noise_count} files that don't clearly belong to any cluster",
                    folder_path=str(settings.root_path / "Uncategorised"),
                    centroid=None,
                    file_count=noise_count,
                    created_at=datetime.utcnow().isoformat(),
                )
            )
            continue
        mask = labels == cid
        cluster_file_indices = np.where(mask)[0]
        cluster_texts = []
        for i in cluster_file_indices[:5]:
            try:
                src = Path(valid_files[i].original_path)
                if src.exists() and extractor.is_supported(src):
                    cluster_texts.append(extractor.extract(src).text[:500])
                else:
                    cluster_texts.append(
                        valid_files[i].summary or valid_files[i].filename
                    )
            except (FileNotFoundError, OSError):
                cluster_texts.append(valid_files[i].summary or valid_files[i].filename)

        name = await namer.generate_cluster_name(
            cluster_texts, list(cluster_names.values())
        )
        # Ensure unique name across this run
        base_name = name
        counter = 2
        while name in cluster_names.values():
            name = f"{base_name}_{counter}"
            counter += 1
        cluster_names[int(cid)] = name

        centroid = centroids.get(int(cid))
        cluster_records.append(
            db.ClusterRecord(
                id=int(cid),
                name=name,
                description=f"Cluster of {int(mask.sum())} semantically related files",
                folder_path=str(settings.root_path / name),
                centroid=centroid,
                file_count=int(mask.sum()),
                created_at=datetime.utcnow().isoformat(),
            )
        )

    # Atomically replace clusters: clear old, write all new at once
    await db.clear_clusters()
    for cr in cluster_records:
        await db.upsert_cluster(cr)

    # Update file records
    file_cluster_map = {}
    for i, f in enumerate(valid_files):
        cid = int(labels[i])
        ux, uy = float(coords_2d[i][0]), float(coords_2d[i][1])
        target_folder = cluster_names.get(cid, "Uncategorised")
        new_path = str(settings.root_path / target_folder / f.filename)

        await db.update_file_cluster(f.id, cid)
        await db.update_file_umap(f.id, ux, uy)

        file_cluster_map[f.id] = {
            "current_path": f.current_path,
            "original_path": f.original_path,
            "filename": f.filename,
            "cluster_id": cid,
        }

    # Sync to OS
    moves = await sync.sync_files_to_folders(file_cluster_map, cluster_names)

    # Update current paths and filenames after moves
    for move in moves:
        await db.update_file_current_path(move["file_id"], move["to"])
        # Update filename to match actual on-disk name (handles collision renames like 1_1.txt)
        new_filename = Path(move["to"]).name
        await db.update_file_filename(move["file_id"], new_filename)

    cluster_summaries = []
    for cid, name in cluster_names.items():
        cluster_summaries.append(
            {
                "cluster_id": cid,
                "name": name,
                "file_count": int((labels == cid).sum()),
            }
        )

    await broadcast(
        {
            "type": "reclustering_end",
            "cluster_count": len(cluster_names),
            "total_moves": len(moves),
            "moves": moves[:10],
            "clusters": cluster_summaries[:10],
        }
    )
    _cluster_elapsed_ms = (__import__("time").perf_counter() - _cluster_start) * 1000
    pipeline_metrics.record_clustering(_cluster_elapsed_ms)
    logger.info(
        f"Clustering complete: {len(cluster_names)} clusters, {len(moves)} files moved"
    )


async def full_scan():
    """Scan the root folder and process all supported files."""
    root = settings.root_path
    root.mkdir(parents=True, exist_ok=True)

    logger.info(f"Full scan of {root}")
    await broadcast({"type": "scan_start", "root": str(root)})

    count = 0
    for path in root.rglob("*"):
        if path.is_file() and extractor.is_supported(path):
            result = await process_file(path)
            if result:
                count += 1

    logger.info(f"Scan complete: {count} files processed")

    if count > 0:
        await run_clustering()

    await broadcast({"type": "scan_complete", "file_count": count})
    return count


# ── Incremental cluster assignment ──────────────────────────────

# Maximum number of new files to handle incrementally (beyond this → full recluster)
_INCREMENTAL_MAX = 5


async def try_incremental_assign(file_id: int) -> bool:
    """Try to assign a newly-processed file to an existing cluster without
    running a full recluster.  Returns True if successfully assigned, False
    if a full recluster is needed instead.

    Conditions for incremental mode:
    - At least one cluster already exists in the DB
    - The file has a valid (non-zero) embedding
    """
    clusters = await db.get_all_clusters()
    if not clusters:
        # No clusters yet → need a full recluster
        return False

    f = await db.get_file_by_id(file_id)
    if not f or f.embedding is None or not np.any(f.embedding):
        return False

    # Build live centroid map from actual file embeddings (stored centroids go
    # stale as more files are added incrementally without a full recluster).
    all_files_for_centroids = await db.get_all_files()
    cluster_centroids: dict[int, np.ndarray] = {}
    for c in clusters:
        members = [
            ff
            for ff in all_files_for_centroids
            if ff.cluster_id == c.id
            and ff.id != file_id
            and ff.embedding is not None
            and np.any(ff.embedding)
        ]
        if members:
            cluster_centroids[c.id] = np.mean(
                [ff.embedding for ff in members], axis=0  # type: ignore[arg-type]
            )
        elif c.centroid is not None and np.any(c.centroid):
            # Fall back to stored centroid if no member files have embeddings
            cluster_centroids[c.id] = c.centroid

    if not cluster_centroids:
        return False

    emb = f.embedding

    # Find closest cluster by cosine similarity
    best_sim = -1.0
    best_cid = -1
    for cid, centroid in cluster_centroids.items():
        # Handle dimension mismatch
        cent = centroid
        if cent.shape[0] != emb.shape[0]:
            if cent.shape[0] < emb.shape[0]:
                cent = np.pad(cent, (0, emb.shape[0] - cent.shape[0]))
            else:
                cent = cent[: emb.shape[0]]
        norm = np.linalg.norm(emb) * np.linalg.norm(cent)
        if norm == 0:
            continue
        sim = float(np.dot(emb, cent) / norm)
        if sim > best_sim:
            best_sim = sim
            best_cid = cid

    # Use the same threshold as the clusterer's noise assignment
    threshold = clusterer.NOISE_SIMILARITY_THRESHOLD
    if best_sim < threshold:
        # Not similar enough to any cluster → needs full recluster to potentially
        # create a new cluster for this content type.
        logger.info(
            f"Incremental assign: {f.filename} best_sim={best_sim:.3f} < {threshold}, "
            f"triggering full recluster"
        )
        return False

    # Assign to the best cluster
    await db.update_file_cluster(f.id, best_cid)

    # Compute simple coords near the cluster center (slight random offset)
    all_files = await db.get_all_files()
    same_cluster = [
        ff for ff in all_files if ff.cluster_id == best_cid and ff.id != f.id
    ]
    if same_cluster:
        avg_x = sum(ff.umap_x for ff in same_cluster) / len(same_cluster)
        avg_y = sum(ff.umap_y for ff in same_cluster) / len(same_cluster)
    else:
        avg_x, avg_y = 0.0, 0.0
    # Small offset so node doesn't overlap exactly
    import random

    offset_x = random.uniform(-20, 20)
    offset_y = random.uniform(-20, 20)
    await db.update_file_umap(f.id, avg_x + offset_x, avg_y + offset_y)

    # Move file to the cluster's folder
    cluster_rec = next((c for c in clusters if c.id == best_cid), None)
    if cluster_rec:
        cluster_name = cluster_rec.name
        target_folder = settings.root_path / cluster_name
        target_folder.mkdir(parents=True, exist_ok=True)
        target_path = target_folder / f.filename

        source = (
            Path(f.current_path)
            if f.current_path and Path(f.current_path).exists()
            else None
        )
        if source is None and f.original_path and Path(f.original_path).exists():
            source = Path(f.original_path)

        if source and source.resolve() != target_path.resolve():
            from app.sync import set_sync_lock, _add_synced_paths
            import shutil

            set_sync_lock(True)
            try:
                if target_path.exists():
                    stem = target_path.stem
                    suffix = target_path.suffix
                    counter = 1
                    while target_path.exists():
                        target_path = target_folder / f"{stem}_{counter}{suffix}"
                        counter += 1
                _add_synced_paths(str(source), str(target_path))
                shutil.move(str(source), str(target_path))
                await db.update_file_current_path(f.id, str(target_path))
                new_filename = target_path.name
                await db.update_file_filename(f.id, new_filename)
                logger.info(f"Incremental: moved {f.filename} → {cluster_name}/")
            except Exception as e:
                logger.error(f"Incremental move failed for {f.filename}: {e}")
            finally:
                import asyncio

                await asyncio.sleep(2.5)
                set_sync_lock(False)

        # Recompute centroid to keep it fresh for the next incremental assign
        updated_count = len(same_cluster) + 1
        new_centroid = cluster_rec.centroid
        all_member_embs = [
            ff.embedding
            for ff in same_cluster
            if ff.embedding is not None and np.any(ff.embedding)
        ]
        if f.embedding is not None and np.any(f.embedding):
            all_member_embs.append(f.embedding)
        if all_member_embs:
            new_centroid = np.mean(all_member_embs, axis=0).astype(np.float32)
        await db.upsert_cluster(
            db.ClusterRecord(
                id=cluster_rec.id,
                name=cluster_rec.name,
                description=cluster_rec.description,
                folder_path=cluster_rec.folder_path,
                centroid=new_centroid,
                file_count=updated_count,
                created_at=cluster_rec.created_at,
            )
        )

    logger.info(
        f"Incremental assign: {f.filename} → cluster {best_cid} (sim={best_sim:.3f})"
    )
    await broadcast(
        {
            "type": "reclustering_end",
            "cluster_count": len(clusters),
            "total_moves": 1 if cluster_rec else 0,
        }
    )
    return True
