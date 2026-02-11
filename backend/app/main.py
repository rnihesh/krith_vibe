"""
SEFS FastAPI Server — REST API + WebSocket for real-time updates.
"""

from __future__ import annotations
import asyncio
import json
import logging
import subprocess
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import numpy as np

from app.config import settings
from app import db, pipeline
from app.watcher import watcher
from app.embedder import get_embedding, get_embedding_matching_dim

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("sefs.main")

# ─── WebSocket Manager ────────────────────────────────────────


class ConnectionManager:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)
        logger.info(f"WebSocket connected ({len(self.connections)} total)")

    def disconnect(self, ws: WebSocket):
        self.connections.remove(ws)
        logger.info(f"WebSocket disconnected ({len(self.connections)} total)")

    async def broadcast(self, data: dict):
        message = json.dumps(data)
        dead = []
        for ws in self.connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.connections.remove(ws)


manager = ConnectionManager()

# ─── Lifecycle ─────────────────────────────────────────────────

_recluster_lock = asyncio.Lock()
_recluster_scheduled = False


async def on_file_change(path: Path):
    """Called by watcher when a file is created or modified."""
    global _recluster_scheduled
    result = await pipeline.process_file(path)
    if result and not _recluster_scheduled:
        _recluster_scheduled = True
        # Delay reclustering to batch rapid changes
        await asyncio.sleep(2)
        _recluster_scheduled = False
        async with _recluster_lock:
            await pipeline.run_clustering()


async def on_file_delete(path: Path):
    """Called by watcher when a file is deleted."""
    await pipeline.remove_file(path)
    async with _recluster_lock:
        await pipeline.run_clustering()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    db_path = Path(__file__).parent.parent / "sefs.db"
    await db.init_db(db_path)

    # Set broadcast function for pipeline
    pipeline.set_broadcast(manager.broadcast)

    # Start file watcher
    loop = asyncio.get_event_loop()
    watcher.start(loop, on_file_change, on_file_delete)

    # Initial scan
    asyncio.create_task(pipeline.full_scan())

    logger.info(f"SEFS Backend started — monitoring {settings.root_path}")
    yield

    # Shutdown
    watcher.stop()
    await db.close_db()
    logger.info("SEFS Backend shut down")


# ─── App ───────────────────────────────────────────────────────

app = FastAPI(title="SEFS Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── REST Endpoints ───────────────────────────────────────────


@app.get("/api/status")
async def get_status():
    files = await db.get_all_files()
    clusters = await db.get_all_clusters()
    return {
        "root_folder": str(settings.root_path),
        "file_count": len(files),
        "cluster_count": len(clusters),
        "status": "running",
    }


@app.get("/api/files")
async def get_files():
    files = await db.get_all_files()
    return [f.to_dict() for f in files]


@app.get("/api/file/{file_id}")
async def get_file(file_id: int):
    f = await db.get_file_by_id(file_id)
    if not f:
        raise HTTPException(404, "File not found")
    return f.to_dict()


@app.get("/api/clusters")
async def get_clusters():
    clusters = await db.get_all_clusters()
    return [c.to_dict() for c in clusters]


@app.get("/api/events")
async def get_events(limit: int = 50):
    return await db.get_recent_events(limit)


@app.get("/api/search")
async def semantic_search(q: str, limit: int = 10):
    """Semantic search over files using cosine similarity of embeddings."""
    if not q or not q.strip():
        return []

    files = await db.get_all_files()

    # Determine embedding dimension from stored files
    target_dim = None
    for f in files:
        if f.embedding is not None and len(f.embedding) > 0:
            target_dim = len(f.embedding)
            break

    if target_dim is None:
        return []

    query_emb = await get_embedding_matching_dim(q.strip(), target_dim)

    scored = []
    for f in files:
        if f.embedding is None or len(f.embedding) == 0:
            continue
        emb = f.embedding
        # Handle dimension mismatch by padding/truncating
        if len(emb) != len(query_emb):
            if len(emb) < len(query_emb):
                emb = np.pad(emb, (0, len(query_emb) - len(emb)))
            else:
                emb = emb[: len(query_emb)]
        # Cosine similarity
        dot = np.dot(query_emb, emb)
        norm = np.linalg.norm(query_emb) * np.linalg.norm(emb)
        sim = float(dot / norm) if norm > 0 else 0.0
        scored.append(
            {
                "file_id": f.id,
                "filename": Path(f.current_path).name if f.current_path else f.filename,
                "summary": f.summary or "",
                "cluster_id": f.cluster_id,
                "current_path": f.current_path,
                "file_type": f.file_type,
                "score": round(sim, 4),
            }
        )

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]


@app.post("/api/rescan")
async def rescan():
    count = await pipeline.full_scan()
    return {"message": f"Scan complete: {count} files processed"}


@app.post("/api/open/{file_id}")
async def open_file(file_id: int):
    """Open a file using the OS default application."""
    f = await db.get_file_by_id(file_id)
    if not f:
        raise HTTPException(404, "File not found")
    path = Path(f.current_path)
    if not path.exists():
        raise HTTPException(404, f"File not found on disk: {path}")
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        elif sys.platform == "win32":
            subprocess.Popen(["start", str(path)], shell=True)
        else:
            subprocess.Popen(["xdg-open", str(path)])
        return {"message": f"Opened {f.filename}"}
    except Exception as e:
        raise HTTPException(500, f"Failed to open file: {e}")


@app.get("/api/graph")
async def get_graph():
    """Return full graph data for visualization."""
    files = await db.get_all_files()
    clusters = await db.get_all_clusters()

    nodes = []
    for f in files:
        nodes.append(
            {
                "id": f"file-{f.id}",
                "file_id": f.id,
                "label": Path(f.current_path).name if f.current_path else f.filename,
                "filename": Path(f.current_path).name if f.current_path else f.filename,
                "cluster_id": f.cluster_id,
                "x": f.umap_x,
                "y": f.umap_y,
                "file_type": f.file_type,
                "size_bytes": f.size_bytes,
                "word_count": f.word_count,
                "page_count": f.page_count,
                "summary": f.summary,
                "current_path": f.current_path,
                "type": "file",
            }
        )

    # Add cluster center nodes
    cluster_map = {}
    for c in clusters:
        cnode = {
            "id": f"cluster-{c.id}",
            "cluster_id": c.id,
            "label": c.name,
            "file_count": c.file_count,
            "description": c.description,
            "type": "cluster",
            "x": 0,
            "y": 0,
        }
        # Compute cluster center from member files
        member_xs = [
            n["x"] for n in nodes if n.get("cluster_id") == c.id and n["type"] == "file"
        ]
        member_ys = [
            n["y"] for n in nodes if n.get("cluster_id") == c.id and n["type"] == "file"
        ]
        if member_xs:
            cnode["x"] = sum(member_xs) / len(member_xs)
            cnode["y"] = sum(member_ys) / len(member_ys)
        nodes.append(cnode)
        cluster_map[c.id] = cnode

    # Build links: file → cluster center
    links = []
    for n in nodes:
        if n["type"] == "file" and n["cluster_id"] in cluster_map:
            links.append(
                {
                    "source": n["id"],
                    "target": f"cluster-{n['cluster_id']}",
                    "value": 1,
                }
            )

    # Build similarity links between files in same cluster
    by_cluster: dict[int, list] = {}
    for n in nodes:
        if n["type"] == "file":
            by_cluster.setdefault(n["cluster_id"], []).append(n)

    for cid, members in by_cluster.items():
        for i in range(len(members)):
            for j in range(i + 1, min(i + 4, len(members))):  # limit edges
                links.append(
                    {
                        "source": members[i]["id"],
                        "target": members[j]["id"],
                        "value": 0.5,
                    }
                )

    return {"nodes": nodes, "links": links, "clusters": [c.to_dict() for c in clusters]}


# ─── WebSocket ─────────────────────────────────────────────────


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_text()
            # Handle incoming messages (e.g., force rescan)
            try:
                msg = json.loads(data)
                if msg.get("type") == "rescan":
                    asyncio.create_task(pipeline.full_scan())
                elif msg.get("type") == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ─── Entry point ───────────────────────────────────────────────


def start():
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    start()
