"""
SEFS Chat — RAG chat endpoint with SSE streaming.
Semantic search for relevant files, build context, stream LLM response.
"""

from __future__ import annotations
import json
import logging
import numpy as np
from pathlib import Path

from app.config import settings
from app import db, embedder, extractor

logger = logging.getLogger("sefs.chat")

SYSTEM_PROMPT = """You are a helpful assistant for SEFS (Semantic Entropy File System), a smart file organizer.
You have access to two kinds of information:
1. **Collection metadata** — total file count, cluster/folder breakdown, file type distribution, and folder structure.
2. **Relevant file contents** — the most semantically similar files found via search for the user's question.

When the user asks about their file collection (e.g. "how many files", "what types of files",
"what clusters exist", "show me a summary"), use the collection metadata.
When the user asks about specific file contents, use the relevant file snippets.
Cite specific filenames when referencing information.
If the provided context doesn't answer the question, say so honestly.
Keep answers concise and helpful."""


from collections import Counter


async def _get_collection_metadata() -> str:
    """Build a metadata summary of the entire file collection."""
    files = await db.get_all_files()
    clusters = await db.get_all_clusters()
    root = str(settings.root_path)

    total = len(files)
    if total == 0:
        return f"Root folder: {root}\nTotal files: 0 (empty collection)"

    # File type distribution
    type_counts = Counter(f.file_type or "unknown" for f in files)
    type_lines = ", ".join(f"{ext}: {cnt}" for ext, cnt in type_counts.most_common(20))

    # Cluster breakdown
    cluster_map: dict[int, list[str]] = {}
    unclustered = []
    for f in files:
        if f.cluster_id is not None and f.cluster_id >= 0:
            cluster_map.setdefault(f.cluster_id, []).append(f.filename)
        else:
            unclustered.append(f.filename)

    cluster_lines = []
    cluster_name_lookup = {c.id: c for c in clusters}
    for cid, fnames in sorted(cluster_map.items()):
        c = cluster_name_lookup.get(cid)
        name = c.name if c else f"Cluster {cid}"
        desc = f" — {c.description}" if c and c.description else ""
        sample = ", ".join(fnames[:5])
        extra = f" (+{len(fnames)-5} more)" if len(fnames) > 5 else ""
        cluster_lines.append(f"  • {name}{desc}: {len(fnames)} files [{sample}{extra}]")
    if unclustered:
        sample = ", ".join(unclustered[:5])
        extra = f" (+{len(unclustered)-5} more)" if len(unclustered) > 5 else ""
        cluster_lines.append(
            f"  • Unclustered: {len(unclustered)} files [{sample}{extra}]"
        )

    # Size stats
    total_size = sum(f.size_bytes or 0 for f in files)

    def _fmt(b: int) -> str:
        if b < 1024:
            return f"{b} B"
        if b < 1024**2:
            return f"{b/1024:.1f} KB"
        return f"{b/1024**2:.1f} MB"

    meta = (
        f"Root folder: {root}\n"
        f"Total files: {total}\n"
        f"Total size: {_fmt(total_size)}\n"
        f"File types: {type_lines}\n"
        f"Clusters ({len(clusters)}):\n" + "\n".join(cluster_lines)
    )
    return meta


async def _get_context_files(query: str, limit: int = 5) -> list[dict]:
    """Find top N relevant files via cosine similarity."""
    files = await db.get_all_files()
    if not files:
        return []

    files_with_emb = [
        f for f in files if f.embedding is not None and np.any(f.embedding)
    ]
    if not files_with_emb:
        return []

    try:
        query_emb = await embedder.get_embedding(query)
    except Exception as e:
        logger.error(f"Failed to embed query: {e}")
        return []

    reembed_budget = 5  # max lazy re-embeds per chat query
    scored = []
    for f in files_with_emb:
        emb = f.embedding
        q = query_emb

        # Lazy re-embed if model doesn't match (up to budget)
        if not embedder.embedding_model_matches(f.embed_model) and reembed_budget > 0:
            try:
                source_text = ""
                src = Path(f.current_path or f.original_path)
                if src.exists() and extractor.is_supported(src):
                    source_text = extractor.extract(src).text
                if not source_text:
                    source_text = f.summary or f.filename
                new_emb = await embedder.get_embedding(source_text)
                if np.any(new_emb):
                    await db.update_file_embedding(
                        f.id, new_emb, embedder.get_current_model_tag()
                    )
                    emb = new_emb
                    reembed_budget -= 1
            except Exception:
                pass  # use existing embedding

        # Handle residual dimension mismatch (last resort fallback)
        if emb.shape[0] != q.shape[0]:
            if emb.shape[0] < q.shape[0]:
                emb = np.pad(emb, (0, q.shape[0] - emb.shape[0]))
            else:
                q = np.pad(q, (0, emb.shape[0] - q.shape[0]))
        norm_q = np.linalg.norm(q)
        norm_f = np.linalg.norm(emb)
        if norm_q == 0 or norm_f == 0:
            continue
        sim = float(np.dot(q, emb) / (norm_q * norm_f))
        scored.append((f, sim))

    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:limit]

    results = []
    for f, score in top:
        # Get content snippet
        snippet = ""
        try:
            src = Path(f.original_path)
            if src.exists() and extractor.is_supported(src):
                result = extractor.extract(src)
                snippet = result.text[:1500]
        except Exception:
            pass

        results.append(
            {
                "file_id": f.id,
                "filename": f.filename,
                "summary": f.summary or "",
                "score": round(score, 4),
                "content_snippet": snippet or (f.summary or "")[:500],
            }
        )

    return results


def _build_context(files: list[dict]) -> str:
    """Build LLM context from file data."""
    if not files:
        return "No relevant files found."

    parts = []
    for i, f in enumerate(files, 1):
        parts.append(f"--- File {i}: {f['filename']} ---")
        if f.get("summary"):
            parts.append(f"Summary: {f['summary']}")
        if f.get("content_snippet"):
            parts.append(f"Content:\n{f['content_snippet']}")
        parts.append("")

    return "\n".join(parts)


async def _stream_ollama(messages: list[dict]):
    """Stream response from Ollama, running the blocking SDK in a thread."""
    import asyncio
    import ollama as ol

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def _run_sync():
        try:
            stream = ol.chat(
                model=settings.ollama_llm_model,
                messages=messages,
                stream=True,
            )
            for chunk in stream:
                if hasattr(chunk, "message"):
                    content = chunk.message.content
                elif isinstance(chunk, dict):
                    content = chunk.get("message", {}).get("content", "")
                else:
                    continue
                if content:
                    loop.call_soon_threadsafe(queue.put_nowait, content)
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, None)
            raise
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    task = loop.run_in_executor(None, _run_sync)

    while True:
        token = await queue.get()
        if token is None:
            break
        yield token

    # Re-raise any exception from the thread
    await task


async def _stream_openai(messages: list[dict]):
    """Stream response from OpenAI."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    stream = await client.chat.completions.create(
        model=settings.openai_model,
        messages=messages,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


async def chat_stream(message: str):
    """SSE streaming chat generator. Accepts pre-parsed message string."""
    if not message:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Empty message'})}\n\n"
        return

    try:
        # Find relevant files
        context_files = await _get_context_files(message)

        # Send sources event
        sources = [
            {
                "file_id": f["file_id"],
                "filename": f["filename"],
                "summary": f["summary"],
                "score": f["score"],
            }
            for f in context_files
        ]
        yield f"data: {json.dumps({'type': 'sources', 'files': sources})}\n\n"

        # Build messages
        metadata = await _get_collection_metadata()
        context = _build_context(context_files)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"=== Collection Metadata ===\n{metadata}\n\n"
                    f"=== Relevant Files ===\n{context}\n\n"
                    f"User question: {message}"
                ),
            },
        ]

        provider = settings.selected_provider
        if provider == "openai":
            if not settings.openai_api_key:
                yield f"data: {json.dumps({'type': 'error', 'message': 'OpenAI provider selected but API key is missing'})}\n\n"
                return
            try:
                async for token in _stream_openai(messages):
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            except Exception as e:
                logger.error(f"OpenAI chat failed: {e}")
                yield f"data: {json.dumps({'type': 'error', 'message': f'OpenAI chat failed: {e}'})}\n\n"
                return
        else:
            try:
                async for token in _stream_ollama(messages):
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            except Exception as e:
                logger.error(f"Ollama chat failed: {e}")
                yield f"data: {json.dumps({'type': 'error', 'message': f'Ollama chat failed: {e}'})}\n\n"
                return

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        logger.error(f"Chat stream error: {e}")
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
