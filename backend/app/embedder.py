"""
SEFS Embedding Engine — Ollama first, OpenAI fallback.
Generates embeddings for document content.
"""

from __future__ import annotations
import logging
import numpy as np
from typing import Optional

from app.config import settings

logger = logging.getLogger("sefs.embedder")

_ollama_available: Optional[bool] = None
EMBED_DIM: int = 768  # default, updated after first call

MAX_CHARS = (
    20000  # ~5000 tokens, safely under 8192 token limits for both Ollama and OpenAI
)


async def get_embedding(text: str) -> np.ndarray:
    """Generate embedding for text. Tries Ollama, falls back to OpenAI."""
    global _ollama_available

    if not text or not text.strip():
        return np.zeros(EMBED_DIM, dtype=np.float32)

    # Truncate very long texts
    if len(text) > MAX_CHARS:
        # Take beginning and end to capture intro + conclusion
        half = MAX_CHARS // 2
        text = text[:half] + "\n...\n" + text[-half:]

    # Try Ollama first
    if _ollama_available is not False:
        try:
            emb = await _embed_ollama(text)
            _ollama_available = True
            return emb
        except Exception as e:
            logger.warning(f"Ollama embedding failed: {e}. Falling back to OpenAI.")
            _ollama_available = False

    # Fallback to OpenAI
    try:
        return await _embed_openai(text)
    except Exception as e:
        logger.error(f"OpenAI embedding also failed: {e}")
        return np.zeros(EMBED_DIM, dtype=np.float32)


async def get_embedding_matching_dim(text: str, target_dim: int) -> np.ndarray:
    """Generate embedding for text, ensuring output matches target_dim.
    If Ollama produces 768-dim but stored embeddings are 1536-dim (OpenAI),
    use OpenAI directly. And vice versa."""
    if not text or not text.strip():
        return np.zeros(target_dim, dtype=np.float32)

    if len(text) > MAX_CHARS:
        half = MAX_CHARS // 2
        text = text[:half] + "\n...\n" + text[-half:]

    # Try Ollama first
    try:
        emb = await _embed_ollama(text)
        if len(emb) == target_dim:
            return emb
        logger.info(f"Ollama dim {len(emb)} != target {target_dim}, trying OpenAI")
    except Exception:
        pass

    # Try OpenAI
    try:
        emb = await _embed_openai(text)
        if len(emb) == target_dim:
            return emb
        logger.info(f"OpenAI dim {len(emb)} != target {target_dim}, truncating/padding")
        # Last resort: pad or truncate
        if len(emb) < target_dim:
            return np.pad(emb, (0, target_dim - len(emb)))
        return emb[:target_dim]
    except Exception as e:
        logger.error(f"All embedding models failed: {e}")
        return np.zeros(target_dim, dtype=np.float32)


async def _embed_ollama(text: str) -> np.ndarray:
    global EMBED_DIM
    import ollama as ol

    response = ol.embed(
        model=settings.ollama_embed_model,
        input=text,
    )

    # ollama returns {"embeddings": [[...]]}
    if hasattr(response, "embeddings"):
        vec = response.embeddings[0]
    elif isinstance(response, dict) and "embeddings" in response:
        vec = response["embeddings"][0]
    else:
        # older ollama versions: {"embedding": [...]}
        vec = response.get("embedding", response)

    arr = np.array(vec, dtype=np.float32)
    EMBED_DIM = len(arr)
    return arr


async def _embed_openai(text: str) -> np.ndarray:
    global EMBED_DIM
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    vec = response.data[0].embedding
    arr = np.array(vec, dtype=np.float32)
    EMBED_DIM = len(arr)
    return arr


async def generate_summary(text: str) -> str:
    """Generate a short summary of document content using LLM."""
    if not text or len(text.strip()) < 50:
        return text[:200] if text else ""

    snippet = text[:3000]

    # Try Ollama LLM
    try:
        import ollama as ol

        response = ol.chat(
            model=settings.ollama_llm_model,
            messages=[
                {
                    "role": "user",
                    "content": f"Summarize this document in 1-2 sentences:\n\n{snippet}",
                }
            ],
        )
        if hasattr(response, "message"):
            return response.message.content[:300]
        return response.get("message", {}).get("content", "")[:300]
    except Exception:
        pass

    # Try OpenAI
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": f"Summarize this document in 1-2 sentences:\n\n{snippet}",
                }
            ],
            max_tokens=100,
        )
        return response.choices[0].message.content[:300]
    except Exception:
        pass

    # Last resort: first 200 chars
    return text[:200].strip() + "..."
