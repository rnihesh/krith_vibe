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

SYSTEM_PROMPT = """You are a helpful assistant that answers questions about files on the user's computer.
You have been given context from the most relevant files found via semantic search.
Answer based on the file contents provided. Cite specific filenames when referencing information.
If the files don't contain relevant information, say so honestly.
Keep answers concise and helpful."""


async def _get_context_files(query: str, limit: int = 5) -> list[dict]:
    """Find top N relevant files via cosine similarity."""
    files = await db.get_all_files()
    if not files:
        return []

    files_with_emb = [f for f in files if f.embedding is not None and np.any(f.embedding)]
    if not files_with_emb:
        return []

    try:
        query_emb = await embedder.get_embedding(query)
    except Exception as e:
        logger.error(f"Failed to embed query: {e}")
        return []

    scored = []
    for f in files_with_emb:
        emb = f.embedding
        q = query_emb
        # Handle dimension mismatch by padding/truncating
        if emb.shape[0] != q.shape[0]:
            if emb.shape[0] < q.shape[0]:
                emb = np.pad(emb, (0, q.shape[0] - emb.shape[0]))
            else:
                q_padded = np.pad(q, (0, emb.shape[0] - q.shape[0]))
                q = q_padded
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

        results.append({
            "file_id": f.id,
            "filename": f.filename,
            "summary": f.summary or "",
            "score": round(score, 4),
            "content_snippet": snippet or (f.summary or "")[:500],
        })

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
        context = _build_context(context_files)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Here are the relevant files from the user's filesystem:\n\n{context}\n\nUser question: {message}",
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
