"""
SEFS File Watcher — monitors root folder for file changes using watchdog.
Uses a single-task debounce: collects pending paths, resets timer on each event,
flushes all pending in one batch when timer fires.
"""

from __future__ import annotations
import asyncio
import logging
import threading
from pathlib import Path
from typing import Callable, Awaitable

from watchdog.observers import Observer
from watchdog.events import (
    FileSystemEventHandler,
)

from app.config import settings
from app.extractor import is_supported
from app.sync import is_sync_locked, is_recently_synced

logger = logging.getLogger("sefs.watcher")

# Debounce window in seconds
DEBOUNCE_SECONDS = 1.5


class SEFSEventHandler(FileSystemEventHandler):
    """Handles filesystem events with single-task debounce and sync-lock awareness."""

    def __init__(
        self, loop: asyncio.AbstractEventLoop, on_change: Callable, on_delete: Callable
    ):
        super().__init__()
        self._loop = loop
        self._on_change = on_change
        self._on_delete = on_delete
        self._pending_changes: dict[str, str] = {}  # path -> action
        self._pending_lock = threading.Lock()
        self._flush_future = None

    def _should_ignore(self, path: str) -> bool:
        p = Path(path)
        if p.name.startswith(".") or p.name.startswith("~"):
            return True
        if not is_supported(p):
            return True
        if is_sync_locked():
            return True
        # Belt-and-suspenders: ignore paths that were recently moved by sync,
        # even if the sync lock has already been released (macOS FSEvents latency).
        if is_recently_synced(path):
            logger.debug(f"Ignoring recently-synced path: {p.name}")
            return True
        return False

    def on_created(self, event):
        if event.is_directory or self._should_ignore(event.src_path):
            return
        logger.debug(f"File created: {event.src_path}")
        self._schedule(event.src_path, "change")

    def on_modified(self, event):
        if event.is_directory or self._should_ignore(event.src_path):
            return
        logger.debug(f"File modified: {event.src_path}")
        self._schedule(event.src_path, "change")

    def on_deleted(self, event):
        if event.is_directory or self._should_ignore(event.src_path):
            return
        logger.debug(f"File deleted: {event.src_path}")
        self._schedule(event.src_path, "delete")

    def on_moved(self, event):
        if event.is_directory:
            return
        if is_sync_locked():
            return
        # Treat as delete old + create new
        if not self._should_ignore(event.src_path):
            self._schedule(event.src_path, "delete")
        if not self._should_ignore(event.dest_path):
            self._schedule(event.dest_path, "change")

    def _schedule(self, path: str, action: str):
        with self._pending_lock:
            self._pending_changes[path] = action
            # Cancel existing timer and reset.
            if self._flush_future and not self._flush_future.done():
                self._flush_future.cancel()
            self._flush_future = asyncio.run_coroutine_threadsafe(
                self._debounce_flush(), self._loop
            )

    async def _debounce_flush(self):
        """Wait for debounce window, then flush all pending paths in one batch."""
        await asyncio.sleep(DEBOUNCE_SECONDS)
        with self._pending_lock:
            # Snapshot and clear pending.
            batch = dict(self._pending_changes)
            self._pending_changes.clear()

        for path, action in batch.items():
            try:
                if action == "change":
                    await self._on_change(Path(path))
                elif action == "delete":
                    await self._on_delete(Path(path))
            except Exception as e:
                logger.error(
                    f"Error processing {action} for {path}: {e}", exc_info=True
                )


class FileWatcher:
    """Manages the watchdog observer for the root folder."""

    def __init__(self):
        self._observer: Observer | None = None
        self._on_change = None
        self._on_delete = None

    def start(self, loop: asyncio.AbstractEventLoop, on_change, on_delete):
        # Stop any existing watcher first (supports restart)
        if self._observer:
            self.stop()

        root = settings.root_path
        root.mkdir(parents=True, exist_ok=True)

        self._on_change = on_change
        self._on_delete = on_delete

        handler = SEFSEventHandler(loop, on_change, on_delete)
        self._observer = Observer()
        self._observer.schedule(handler, str(root), recursive=True)
        self._observer.daemon = True
        self._observer.start()
        logger.info(f"File watcher started on {root}")

    def stop(self):
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
            logger.info("File watcher stopped")


# Singleton
watcher = FileWatcher()
