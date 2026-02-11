"""
SEFS OS Synchronizer — moves files into semantic folders at the OS level.
Uses a sync lock to distinguish system moves from user moves.
"""

from __future__ import annotations
import asyncio
import logging
import shutil
import threading
import time
from pathlib import Path
from typing import Optional

from app.config import settings

logger = logging.getLogger("sefs.sync")

# Sync lock — when True, file watcher should ignore move events
_sync_lock = False
_sync_lock_event = asyncio.Event()
_sync_lock_event.set()  # unlocked by default

# Recently-synced paths — belt-and-suspenders guard against late FSEvents
_recently_synced_paths: set[str] = set()
_synced_paths_lock = threading.Lock()
_SYNCED_PATH_TTL = 5.0  # seconds to remember paths


def is_recently_synced(path: str) -> bool:
    """Check if a path was recently involved in a sync move."""
    with _synced_paths_lock:
        return path in _recently_synced_paths


def _add_synced_paths(*paths: str):
    """Add paths to the recently-synced set and schedule cleanup."""
    with _synced_paths_lock:
        for p in paths:
            _recently_synced_paths.add(p)

    # Schedule cleanup after TTL (fire-and-forget thread timer)
    def _cleanup():
        with _synced_paths_lock:
            for p in paths:
                _recently_synced_paths.discard(p)

    timer = threading.Timer(_SYNCED_PATH_TTL, _cleanup)
    timer.daemon = True
    timer.start()


def is_sync_locked() -> bool:
    return _sync_lock


def set_sync_lock(locked: bool):
    global _sync_lock
    _sync_lock = locked
    if locked:
        _sync_lock_event.clear()
    else:
        _sync_lock_event.set()


async def sync_files_to_folders(
    file_cluster_map: dict[int, dict],
    cluster_names: dict[int, str],
    root: Optional[Path] = None,
) -> list[dict]:
    """
    Move files into cluster-named folders within the root directory.

    Args:
        file_cluster_map: {file_id: {"current_path": str, "original_path": str, "filename": str, "cluster_id": int}}
        cluster_names: {cluster_id: "Folder_Name"}
        root: root folder path

    Returns:
        List of move operations performed: [{"file_id": int, "from": str, "to": str}]
    """
    root = root or settings.root_path
    moves = []

    set_sync_lock(True)
    try:
        # Create cluster folders
        for cid, name in cluster_names.items():
            folder = root / name
            folder.mkdir(parents=True, exist_ok=True)

        # Move files
        for fid, info in file_cluster_map.items():
            current = Path(info["current_path"]) if info.get("current_path") else None
            original = (
                Path(info["original_path"]) if info.get("original_path") else None
            )
            cid = info["cluster_id"]
            target_folder_name = cluster_names.get(cid, "Uncategorised")
            target_folder = root / target_folder_name
            target_folder.mkdir(parents=True, exist_ok=True)
            target_path = target_folder / info["filename"]

            # Resolve best existing source path. current_path can be stale if user moved files manually.
            source = None
            if current and current.exists():
                source = current
            elif original and original.exists():
                source = original
            else:
                fallback = root / info["filename"]
                if fallback.exists():
                    source = fallback

            if source is None:
                logger.warning(
                    f"Skip move for file_id={fid}: source missing "
                    f"(current={current}, original={original})"
                )
                continue

            # Skip if already in correct location
            if source.resolve() == target_path.resolve():
                continue

            # Handle name collisions
            if target_path.exists():
                stem = target_path.stem
                suffix = target_path.suffix
                counter = 1
                while target_path.exists():
                    target_path = target_folder / f"{stem}_{counter}{suffix}"
                    counter += 1

            # Move the file
            try:
                # Register both source and destination so watcher ignores late FSEvents
                _add_synced_paths(str(source), str(target_path))
                shutil.move(str(source), str(target_path))
                moves.append(
                    {
                        "file_id": fid,
                        "from": str(source),
                        "to": str(target_path),
                    }
                )
                logger.info(f"Moved {source.name} → {target_folder_name}/")
            except Exception as e:
                logger.error(f"Failed to move {source}: {e}")

        # Clean up empty directories (except root and cluster folders)
        _cleanup_empty_dirs(root, set(cluster_names.values()))

    finally:
        # Longer delay for macOS FSEvents latency (~1-2s) before unlocking
        await asyncio.sleep(2.5)
        set_sync_lock(False)

    return moves


def _cleanup_empty_dirs(root: Path, keep_names: set[str]):
    """Remove empty directories, keeping cluster folders even if empty."""
    for d in sorted(root.rglob("*"), reverse=True):
        if d.is_dir() and d != root:
            # Keep cluster folders
            if d.name in keep_names and d.parent == root:
                continue
            try:
                if not any(d.iterdir()):
                    d.rmdir()
                    logger.info(f"Removed empty directory: {d.name}")
            except Exception:
                pass
