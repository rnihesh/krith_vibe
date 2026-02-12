"""
SEFS Metadata Store — SQLite-backed persistence for files, clusters, events.
"""

from __future__ import annotations
import asyncio
import aiosqlite
import json
import numpy as np
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime

DB_PATH: Path | None = None
_db: aiosqlite.Connection | None = None
_lock = asyncio.Lock()

# Global settings DB (lives at backend/sefs.db — stores provider, keys, root_folder)
_global_db: aiosqlite.Connection | None = None
_GLOBAL_DB_PATH: Path | None = None

_GLOBAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

# Per-folder data DB (lives at <root_folder>/.sefs.db — stores files, clusters, events)
SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_path TEXT NOT NULL,
    current_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding BLOB,
    umap_x REAL DEFAULT 0.0,
    umap_y REAL DEFAULT 0.0,
    cluster_id INTEGER DEFAULT -1,
    summary TEXT DEFAULT '',
    file_type TEXT DEFAULT '',
    size_bytes INTEGER DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    page_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    UNIQUE(original_path)
);

CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    folder_path TEXT DEFAULT '',
    centroid BLOB,
    file_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER,
    event_type TEXT NOT NULL,
    detail TEXT DEFAULT '',
    timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_cluster ON files(cluster_id);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp DESC);
"""


@dataclass
class FileRecord:
    id: int = 0
    filename: str = ""
    original_path: str = ""
    current_path: str = ""
    content_hash: str = ""
    embedding: Optional[np.ndarray] = None
    umap_x: float = 0.0
    umap_y: float = 0.0
    cluster_id: int = -1
    summary: str = ""
    file_type: str = ""
    size_bytes: int = 0
    word_count: int = 0
    page_count: int = 0
    created_at: str = ""
    modified_at: str = ""

    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "filename": self.filename,
            "original_path": self.original_path,
            "current_path": self.current_path,
            "cluster_id": self.cluster_id,
            "summary": self.summary,
            "file_type": self.file_type,
            "size_bytes": self.size_bytes,
            "word_count": self.word_count,
            "page_count": self.page_count,
            "umap_x": self.umap_x,
            "umap_y": self.umap_y,
            "created_at": self.created_at,
            "modified_at": self.modified_at,
        }
        return d


@dataclass
class ClusterRecord:
    id: int = 0
    name: str = ""
    description: str = ""
    folder_path: str = ""
    centroid: Optional[np.ndarray] = None
    file_count: int = 0
    created_at: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "folder_path": self.folder_path,
            "file_count": self.file_count,
            "created_at": self.created_at,
        }


def _embed_to_bytes(arr: Optional[np.ndarray]) -> Optional[bytes]:
    if arr is None:
        return None
    return arr.astype(np.float32).tobytes()


def _bytes_to_embed(b: Optional[bytes]) -> Optional[np.ndarray]:
    if b is None:
        return None
    return np.frombuffer(b, dtype=np.float32).copy()


async def init_global_db(db_path: Path):
    """Open the global settings-only DB (backend/sefs.db)."""
    global _GLOBAL_DB_PATH, _global_db
    _GLOBAL_DB_PATH = db_path
    _global_db = await aiosqlite.connect(str(db_path))
    _global_db.row_factory = aiosqlite.Row
    await _global_db.executescript(_GLOBAL_SCHEMA)
    await _global_db.commit()


async def init_db(db_path: Path):
    """Open (or create) the per-folder data DB."""
    global DB_PATH, _db
    DB_PATH = db_path
    _db = await aiosqlite.connect(str(db_path))
    _db.row_factory = aiosqlite.Row
    await _db.executescript(SCHEMA)
    await _db.commit()


def get_folder_db_path(root: Path) -> Path:
    """Return the per-folder DB path: <root>/.sefs.db"""
    return root / ".sefs.db"


async def switch_folder_db(new_root: Path):
    """Close current per-folder DB and open the one in new_root."""
    global _db, DB_PATH
    if _db:
        await _db.close()
        _db = None
    folder_db = get_folder_db_path(new_root)
    await init_db(folder_db)


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        raise RuntimeError("Database not initialised. Call init_db first.")
    return _db


async def close_db():
    global _db, _global_db
    if _db:
        await _db.close()
        _db = None
    if _global_db:
        await _global_db.close()
        _global_db = None


# ─── File operations ───────────────────────────────────────────


async def upsert_file(f: FileRecord) -> int:
    db = await get_db()
    async with _lock:
        await db.execute(
            """INSERT INTO files
               (filename, original_path, current_path, content_hash,
                embedding, umap_x, umap_y, cluster_id, summary,
                file_type, size_bytes, word_count, page_count,
                created_at, modified_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(original_path) DO UPDATE SET
                filename=excluded.filename,
                current_path=excluded.current_path,
                content_hash=excluded.content_hash,
                embedding=excluded.embedding,
                umap_x=excluded.umap_x,
                umap_y=excluded.umap_y,
                cluster_id=excluded.cluster_id,
                summary=excluded.summary,
                file_type=excluded.file_type,
                size_bytes=excluded.size_bytes,
                word_count=excluded.word_count,
                page_count=excluded.page_count,
                modified_at=excluded.modified_at
            """,
            (
                f.filename,
                f.original_path,
                f.current_path,
                f.content_hash,
                _embed_to_bytes(f.embedding),
                f.umap_x,
                f.umap_y,
                f.cluster_id,
                f.summary,
                f.file_type,
                f.size_bytes,
                f.word_count,
                f.page_count,
                f.created_at,
                f.modified_at,
            ),
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT id FROM files WHERE original_path=?", (f.original_path,)
        )
        row = await cursor.fetchone()
        return row[0] if row else 0


async def get_file_by_path(path: str) -> Optional[FileRecord]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM files WHERE original_path=? OR current_path=?", (path, path)
    )
    row = await cursor.fetchone()
    if not row:
        return None
    return _row_to_file(row)


async def get_file_by_id(file_id: int) -> Optional[FileRecord]:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM files WHERE id=?", (file_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    return _row_to_file(row)


async def get_file_by_hash(content_hash: str) -> Optional[FileRecord]:
    """Return the most recently updated record for a content hash."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM files WHERE content_hash=? ORDER BY id DESC LIMIT 1",
        (content_hash,),
    )
    row = await cursor.fetchone()
    if not row:
        return None
    return _row_to_file(row)


async def get_all_files() -> list[FileRecord]:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM files ORDER BY id")
    rows = await cursor.fetchall()
    return [_row_to_file(r) for r in rows]


async def delete_file_by_path(path: str):
    db = await get_db()
    async with _lock:
        await db.execute(
            "DELETE FROM files WHERE original_path=? OR current_path=?", (path, path)
        )
        await db.commit()


async def delete_file_by_id(file_id: int):
    db = await get_db()
    async with _lock:
        await db.execute("DELETE FROM files WHERE id=?", (file_id,))
        await db.commit()


async def update_file_cluster(file_id: int, cluster_id: int):
    db = await get_db()
    async with _lock:
        await db.execute(
            "UPDATE files SET cluster_id=? WHERE id=?", (cluster_id, file_id)
        )
        await db.commit()


async def update_file_umap(file_id: int, x: float, y: float):
    db = await get_db()
    async with _lock:
        await db.execute(
            "UPDATE files SET umap_x=?, umap_y=? WHERE id=?", (x, y, file_id)
        )
        await db.commit()


async def update_file_embedding(file_id: int, embedding: np.ndarray):
    db = await get_db()
    async with _lock:
        await db.execute(
            "UPDATE files SET embedding=? WHERE id=?",
            (_embed_to_bytes(embedding), file_id),
        )
        await db.commit()


async def update_file_current_path(file_id: int, new_path: str):
    db = await get_db()
    async with _lock:
        await db.execute(
            "UPDATE files SET current_path=? WHERE id=?", (new_path, file_id)
        )
        await db.commit()


async def update_file_filename(file_id: int, new_filename: str):
    """Update the filename field to match the actual on-disk name (e.g. after collision rename)."""
    db = await get_db()
    async with _lock:
        await db.execute(
            "UPDATE files SET filename=? WHERE id=?", (new_filename, file_id)
        )
        await db.commit()


async def update_file_paths(
    file_id: int,
    original_path: str,
    current_path: str,
    filename: str,
    modified_at: Optional[str] = None,
):
    """Update identity paths when a file is relocated/renamed by the user."""
    db = await get_db()
    if modified_at is None:
        modified_at = datetime.utcnow().isoformat()
    async with _lock:
        await db.execute(
            """
            UPDATE files
            SET original_path=?, current_path=?, filename=?, modified_at=?
            WHERE id=?
            """,
            (original_path, current_path, filename, modified_at, file_id),
        )
        await db.commit()


async def bulk_update_clusters(updates: list[tuple[int, int, float, float, str]]):
    """updates = [(file_id, cluster_id, umap_x, umap_y, current_path), ...]"""
    db = await get_db()
    async with _lock:
        await db.executemany(
            "UPDATE files SET cluster_id=?, umap_x=?, umap_y=?, current_path=? WHERE id=?",
            [(c, x, y, p, fid) for fid, c, x, y, p in updates],
        )
        await db.commit()


def _row_to_file(row) -> FileRecord:
    return FileRecord(
        id=row["id"],
        filename=row["filename"],
        original_path=row["original_path"],
        current_path=row["current_path"],
        content_hash=row["content_hash"],
        embedding=_bytes_to_embed(row["embedding"]),
        umap_x=row["umap_x"],
        umap_y=row["umap_y"],
        cluster_id=row["cluster_id"],
        summary=row["summary"],
        file_type=row["file_type"],
        size_bytes=row["size_bytes"],
        word_count=row["word_count"],
        page_count=row["page_count"],
        created_at=row["created_at"],
        modified_at=row["modified_at"],
    )


# ─── Cluster operations ───────────────────────────────────────


async def upsert_cluster(c: ClusterRecord):
    db = await get_db()
    async with _lock:
        await db.execute(
            """INSERT OR REPLACE INTO clusters
               (id, name, description, folder_path, centroid, file_count, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (
                c.id,
                c.name,
                c.description,
                c.folder_path,
                _embed_to_bytes(c.centroid),
                c.file_count,
                c.created_at,
            ),
        )
        await db.commit()


async def get_all_clusters() -> list[ClusterRecord]:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM clusters ORDER BY id")
    rows = await cursor.fetchall()
    results = []
    for row in rows:
        results.append(
            ClusterRecord(
                id=row["id"],
                name=row["name"],
                description=row["description"],
                folder_path=row["folder_path"],
                centroid=_bytes_to_embed(row["centroid"]),
                file_count=row["file_count"],
                created_at=row["created_at"],
            )
        )
    return results


async def clear_clusters():
    db = await get_db()
    async with _lock:
        await db.execute("DELETE FROM clusters")
        await db.commit()


# ─── Event operations ─────────────────────────────────────────


async def add_event(file_id: int, event_type: str, detail: str = ""):
    db = await get_db()
    async with _lock:
        await db.execute(
            "INSERT INTO events (file_id, event_type, detail, timestamp) VALUES (?,?,?,?)",
            (file_id, event_type, detail, datetime.utcnow().isoformat()),
        )
        await db.commit()


# ─── Settings operations (use GLOBAL DB) ─────────────────────


async def _get_global_db() -> aiosqlite.Connection:
    if _global_db is None:
        raise RuntimeError("Global database not initialised.")
    return _global_db


async def get_setting(key: str) -> Optional[str]:
    db = await _get_global_db()
    cursor = await db.execute("SELECT value FROM settings WHERE key=?", (key,))
    row = await cursor.fetchone()
    return row["value"] if row else None


async def get_all_settings() -> dict[str, str]:
    db = await _get_global_db()
    cursor = await db.execute("SELECT key, value FROM settings")
    rows = await cursor.fetchall()
    return {r["key"]: r["value"] for r in rows}


async def set_setting(key: str, value: str):
    db = await _get_global_db()
    async with _lock:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        await db.commit()


async def set_settings_bulk(settings_dict: dict[str, str]):
    db = await _get_global_db()
    async with _lock:
        for key, value in settings_dict.items():
            await db.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )
        await db.commit()


# ─── Event operations ─────────────────────────────────────


async def get_recent_events(limit: int = 50) -> list[dict]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", (limit,)
    )
    rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "file_id": r["file_id"],
            "event_type": r["event_type"],
            "detail": r["detail"],
            "timestamp": r["timestamp"],
        }
        for r in rows
    ]
