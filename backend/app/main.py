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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

import numpy as np

from app.config import settings
from app import db, pipeline, extractor
from app.watcher import watcher
from app.embedder import get_embedding
from app import settings as settings_module
from app.chat import chat_stream
from app.metrics import metrics as pipeline_metrics

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("sefs.main")


# ─── Recluster Scheduler ─────────────────────────────────────


class ReclusterScheduler:
    """Debounces rapid recluster requests and ensures only one runs at a time.
    Includes a cooldown to prevent spurious re-clustering after sync moves."""

    COOLDOWN_SECONDS = 5.0  # minimum gap between consecutive reclusters

    def __init__(self, delay: float = 2.0):
        self._delay = delay
        self._lock = asyncio.Lock()
        self._pending = False
        self._timer_task: asyncio.Task | None = None
        self._last_completed: float = 0.0  # monotonic timestamp

    async def request(self):
        """Request a recluster. Debounces by self._delay seconds."""
        self._pending = True
        if self._timer_task and not self._timer_task.done():
            self._timer_task.cancel()
        self._timer_task = asyncio.create_task(self._run_after_delay())

    async def _run_after_delay(self):
        await asyncio.sleep(self._delay)
        await self._execute()

    async def _execute(self):
        async with self._lock:
            while self._pending:
                self._pending = False
                # Cooldown: skip if we just finished a recluster
                import time as _time

                elapsed = _time.monotonic() - self._last_completed
                if self._last_completed > 0 and elapsed < self.COOLDOWN_SECONDS:
                    logger.info(
                        f"Recluster cooldown: {elapsed:.1f}s < {self.COOLDOWN_SECONDS}s, skipping"
                    )
                    continue
                await pipeline.run_clustering()
                self._last_completed = _time.monotonic()


recluster_scheduler = ReclusterScheduler()

# ─── WebSocket Manager ────────────────────────────────────────


class ConnectionManager:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)
        logger.info(f"WebSocket connected ({len(self.connections)} total)")

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
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
            if ws in self.connections:
                self.connections.remove(ws)


manager = ConnectionManager()

# ─── Lifecycle ─────────────────────────────────────────────────


async def on_file_change(path: Path):
    """Called by watcher when a file is created or modified."""
    result = await pipeline.process_file(path)
    if result:
        # Try incremental assignment first; only full recluster if needed
        assigned = await pipeline.try_incremental_assign(result)
        if not assigned:
            await recluster_scheduler.request()


async def on_file_delete(path: Path):
    """Called by watcher when a file is deleted."""
    await pipeline.remove_file(path)
    await recluster_scheduler.request()


async def _startup_health_check():
    """Verify selected provider is reachable."""
    import httpx

    if settings.selected_provider == "openai":
        if not settings.openai_api_key:
            logger.warning(
                "Provider is OpenAI but OPENAI_API_KEY is empty. Embeddings/chat will fail."
            )
            return
        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=settings.openai_api_key)
            await asyncio.wait_for(client.models.list(), timeout=8.0)
            logger.info("OpenAI is reachable")
        except Exception as e:
            logger.warning(f"OpenAI health check failed: {e}")
        return

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.ollama_host}/api/tags")
            if resp.status_code == 200:
                logger.info("Ollama is reachable")
                return
            logger.warning(f"Ollama health check returned {resp.status_code}")
    except Exception as e:
        logger.warning(f"Ollama health check failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    db_path = Path(__file__).parent.parent / "sefs.db"
    await db.init_db(db_path)

    # Load saved settings into runtime config
    stored = await db.get_all_settings()
    if stored:
        settings.update_from_dict(stored)
        logger.info(
            f"Loaded saved settings (provider={stored.get('provider', 'ollama')})"
        )
    else:
        # Do not implicitly use OPENAI_API_KEY from environment.
        settings.update_from_dict({"openai_api_key": ""})

    # Set broadcast function for pipeline
    pipeline.set_broadcast(manager.broadcast)

    # Health check
    await _startup_health_check()

    # Run initial scan BEFORE starting the watcher so sync-moves during clustering
    # don't trigger spurious watcher events that corrupt cluster state.
    await pipeline.full_scan()

    # Start file watcher AFTER initial scan is complete
    loop = asyncio.get_event_loop()
    watcher.start(loop, on_file_change, on_file_delete)

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
    limit = max(1, min(limit, 200))
    return await db.get_recent_events(limit)


@app.get("/api/search")
async def semantic_search(q: str, limit: int = 10):
    """Semantic search over files using cosine similarity of embeddings."""
    limit = max(1, min(limit, 50))
    if not q or not q.strip():
        return []

    files = await db.get_all_files()

    try:
        query_emb = await asyncio.wait_for(get_embedding(q.strip()), timeout=15.0)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Embedding generation timed out")

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


# ─── Settings Endpoints ──────────────────────────────────────


@app.get("/api/settings")
async def api_get_settings():
    return await settings_module.get_settings()


@app.put("/api/settings")
async def api_save_settings(data: dict):
    return await settings_module.save_settings(data)


@app.post("/api/settings/test")
async def api_test_connection(data: dict):
    return await settings_module.test_connection(data)


# ─── Chat Endpoint ───────────────────────────────────────────


@app.post("/api/chat")
async def api_chat(request: Request):
    body = await request.json()
    message = body.get("message", "").strip()
    return StreamingResponse(
        chat_stream(message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Related Files Endpoint ──────────────────────────────────


@app.get("/api/file/{file_id}/related")
async def get_related_files(file_id: int, limit: int = 5):
    """Find files most similar to a given file via cosine similarity."""
    limit = max(1, min(limit, 20))
    target = await db.get_file_by_id(file_id)
    if not target:
        raise HTTPException(404, "File not found")
    if target.embedding is None or not np.any(target.embedding):
        return []

    files = await db.get_all_files()
    target_emb = target.embedding
    target_norm = np.linalg.norm(target_emb)
    if target_norm == 0:
        return []

    scored = []
    for f in files:
        if f.id == file_id:
            continue
        if f.embedding is None or not np.any(f.embedding):
            continue
        emb = f.embedding
        if emb.shape[0] != target_emb.shape[0]:
            if emb.shape[0] < target_emb.shape[0]:
                emb = np.pad(emb, (0, target_emb.shape[0] - emb.shape[0]))
            else:
                emb = emb[: target_emb.shape[0]]
        norm_f = np.linalg.norm(emb)
        if norm_f == 0:
            continue
        sim = float(np.dot(target_emb, emb) / (target_norm * norm_f))
        scored.append(
            {
                "file_id": f.id,
                "filename": Path(f.current_path).name if f.current_path else f.filename,
                "cluster_id": f.cluster_id,
                "similarity": round(sim, 4),
                "summary": f.summary or "",
            }
        )

    scored.sort(key=lambda x: x["similarity"], reverse=True)
    return scored[:limit]


def _get_file_compare_text(file_record, max_chars: int = 1500) -> str:
    """Load text for compare endpoint, falling back to summary/filename."""
    source = Path(file_record.current_path or file_record.original_path)
    try:
        if source.exists() and extractor.is_supported(source):
            extracted = extractor.extract(source).text.strip()
            if extracted:
                return extracted[:max_chars]
    except Exception:
        pass
    fallback = (file_record.summary or file_record.filename or "").strip()
    return fallback[:max_chars]


def _fallback_compare_text(file_a: str, file_b: str, text_a: str, text_b: str) -> str:
    words_a = {w.lower() for w in text_a.split() if len(w) > 3}
    words_b = {w.lower() for w in text_b.split() if len(w) > 3}
    overlap = sorted(words_a.intersection(words_b))
    if overlap:
        top = ", ".join(overlap[:8])
        return (
            f"{file_a} and {file_b} appear related through these shared terms: {top}. "
            "The relationship is inferred from overlapping vocabulary."
        )
    return (
        f"{file_a} and {file_b} have limited direct vocabulary overlap in available snippets. "
        "They may still be related conceptually, but the current summaries do not show a strong match."
    )


@app.get("/api/file/{file_id_1}/compare/{file_id_2}")
async def compare_files(file_id_1: int, file_id_2: int):
    """Explain relationship between two files using selected LLM provider."""
    if file_id_1 == file_id_2:
        f = await db.get_file_by_id(file_id_1)
        if not f:
            raise HTTPException(404, "File not found")
        return {
            "file_1": {"id": f.id, "filename": f.filename},
            "file_2": {"id": f.id, "filename": f.filename},
            "provider": settings.selected_provider,
            "analysis": "Both IDs refer to the same file, so there is no cross-file comparison.",
        }

    f1 = await db.get_file_by_id(file_id_1)
    f2 = await db.get_file_by_id(file_id_2)
    if not f1 or not f2:
        raise HTTPException(404, "One or both files not found")

    text_1 = _get_file_compare_text(f1)
    text_2 = _get_file_compare_text(f2)

    prompt = (
        "Compare these two files and explain:\n"
        "1) their shared themes\n"
        "2) key differences\n"
        "3) a one-line relationship summary.\n\n"
        f"File A ({f1.filename}):\n{text_1}\n\n"
        f"File B ({f2.filename}):\n{text_2}\n\n"
        "Answer in <= 140 words."
    )

    analysis = ""
    provider = settings.selected_provider
    try:
        if provider == "openai":
            if not settings.openai_api_key:
                raise RuntimeError("OpenAI provider selected but API key is missing")
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=settings.openai_api_key)
            response = await client.chat.completions.create(
                model=settings.openai_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=220,
            )
            analysis = (response.choices[0].message.content or "").strip()
        else:
            import ollama as ol

            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                None,
                lambda: ol.chat(
                    model=settings.ollama_llm_model,
                    messages=[{"role": "user", "content": prompt}],
                ),
            )
            if hasattr(response, "message"):
                analysis = (response.message.content or "").strip()
            elif isinstance(response, dict):
                analysis = (
                    response.get("message", {}).get("content", "") or ""
                ).strip()
    except Exception as e:
        logger.warning(f"Compare endpoint using {provider} failed: {e}")

    if not analysis:
        analysis = _fallback_compare_text(f1.filename, f2.filename, text_1, text_2)

    return {
        "file_1": {"id": f1.id, "filename": f1.filename},
        "file_2": {"id": f2.id, "filename": f2.filename},
        "provider": provider,
        "analysis": analysis,
    }


# ─── Metrics Endpoint ────────────────────────────────────────


@app.get("/api/metrics")
async def api_get_metrics():
    return pipeline_metrics.get_summary()


# ─── WebSocket ─────────────────────────────────────────────────


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "rescan":
                    asyncio.create_task(pipeline.full_scan())
                elif msg.get("type") == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WebSocket error: {e}")
    finally:
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
