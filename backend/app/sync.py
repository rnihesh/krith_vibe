"""
SEFS OS Synchronizer — moves files into semantic folders at the OS level.
Uses a sync lock to distinguish system moves from user moves.
"""

from __future__ import annotations
import asyncio
import logging
import shutil
from pathlib import Path
from typing import Optional

from app.config import settings

logger = logging.getLogger("sefs.sync")

# Sync lock — when True, file watcher should ignore move events
_sync_lock = False
_sync_lock_event = asyncio.Event()
_sync_lock_event.set()  # unlocked by default


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
        file_cluster_map: {file_id: {"current_path": str, "filename": str, "cluster_id": int}}
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
            current = Path(info["current_path"])
            cid = info["cluster_id"]
            target_folder_name = cluster_names.get(cid, "Uncategorised")
            target_folder = root / target_folder_name
            target_folder.mkdir(parents=True, exist_ok=True)
            target_path = target_folder / info["filename"]

            # Skip if already in correct location
            if current.resolve() == target_path.resolve():
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
                if current.exists():
                    shutil.move(str(current), str(target_path))
                    moves.append(
                        {
                            "file_id": fid,
                            "from": str(current),
                            "to": str(target_path),
                        }
                    )
                    logger.info(f"Moved {current.name} → {target_folder_name}/")
            except Exception as e:
                logger.error(f"Failed to move {current}: {e}")

        # Clean up empty directories (except root and cluster folders)
        _cleanup_empty_dirs(root, set(cluster_names.values()))

    finally:
        # Small delay to let filesystem events settle before unlocking
        await asyncio.sleep(0.5)
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
