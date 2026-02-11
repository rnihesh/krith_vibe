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

logger = logging.getLogger("sefs.pipeline")

# WebSocket broadcast callback — set by main.py
_broadcast_fn = None


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


async def broadcast(event: dict):
    if _broadcast_fn:
        await _broadcast_fn(event)


async def process_file(path: Path) -> int | None:
    """Process a single file: extract, embed, store. Returns file DB id."""
    if not path.exists() or not extractor.is_supported(path):
        return None

    logger.info(f"Processing file: {path.name}")
    await broadcast({"type": "processing_start", "filename": path.name})

    try:
        # Extract content
        result = extractor.extract(path)
        if not result.text.strip():
            logger.warning(f"No text extracted from {path.name}")
            return None

        # Check if already processed with same hash
        existing = await db.get_file_by_path(str(path))
        if existing and existing.content_hash == result.content_hash:
            logger.info(f"File unchanged, skipping: {path.name}")
            return existing.id

        # Generate embedding
        embedding = await embedder.get_embedding(result.text)

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
        event_type = "file_modified" if existing else "file_added"
        await db.add_event(file_id, event_type, path.name)
        await broadcast({"type": event_type, "file_id": file_id, "filename": path.name})

        logger.info(f"Processed {path.name} (id={file_id}, words={result.word_count})")
        return file_id

    except Exception as e:
        logger.error(f"Failed to process {path.name}: {e}", exc_info=True)
        return None


async def remove_file(path: Path):
    """Remove a file from the database."""
    existing = await db.get_file_by_path(str(path))
    if existing:
        await db.delete_file_by_path(str(path))
        await db.add_event(existing.id, "file_removed", path.name)
        await broadcast(
            {"type": "file_removed", "file_id": existing.id, "filename": path.name}
        )
        logger.info(f"Removed {path.name} from DB")


async def run_clustering():
    """Re-cluster all files and sync to OS folders."""
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
        logger.info("Not enough files with embeddings to cluster")
        # If there's one file, put it in cluster 0
        if valid_files:
            f = valid_files[0]
            await db.update_file_cluster(f.id, 0)
            await db.update_file_umap(f.id, 0.0, 0.0)
        return

    await broadcast({"type": "reclustering_start"})

    emb_matrix = np.vstack(embeddings)

    # Cluster
    labels, coords_2d = clusterer.cluster_embeddings(emb_matrix)
    centroids = clusterer.compute_centroids(emb_matrix, labels)

    # Scale coords for visualization (spread them out)
    if coords_2d.max() != coords_2d.min():
        coords_2d = (coords_2d - coords_2d.min()) / (coords_2d.max() - coords_2d.min())
        coords_2d = coords_2d * 800 - 400  # spread -400 to 400

    # Generate cluster names
    unique_labels = sorted(set(labels))
    existing_clusters = await db.get_all_clusters()
    existing_names = [c.name for c in existing_clusters]

    await db.clear_clusters()
    cluster_names = {}

    for cid in unique_labels:
        if cid < 0:
            continue
        mask = labels == cid
        cluster_file_indices = np.where(mask)[0]
        cluster_texts = [
            (
                extractor.extract(Path(valid_files[i].original_path)).text[:500]
                if Path(valid_files[i].original_path).exists()
                else valid_files[i].summary
            )
            for i in cluster_file_indices[:5]
        ]

        name = await namer.generate_cluster_name(
            cluster_texts, list(cluster_names.values())
        )
        cluster_names[int(cid)] = name

        centroid = centroids.get(int(cid))
        cluster_record = db.ClusterRecord(
            id=int(cid),
            name=name,
            description=f"Cluster of {int(mask.sum())} semantically related files",
            folder_path=str(settings.root_path / name),
            centroid=centroid,
            file_count=int(mask.sum()),
            created_at=datetime.utcnow().isoformat(),
        )
        await db.upsert_cluster(cluster_record)

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
            "filename": f.filename,
            "cluster_id": cid,
        }

    # Sync to OS
    moves = await sync.sync_files_to_folders(file_cluster_map, cluster_names)

    # Update current paths after moves
    for move in moves:
        await db.update_file_current_path(move["file_id"], move["to"])

    await broadcast({"type": "reclustering_end", "cluster_count": len(cluster_names)})
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
