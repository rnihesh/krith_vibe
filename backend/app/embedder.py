"""
SEFS Embedding Engine.
Uses the provider selected in settings (Ollama or OpenAI), without cross-provider fallback.
"""

from __future__ import annotations
import asyncio
import logging
from typing import Optional

import numpy as np

from app.config import settings

logger = logging.getLogger("sefs.embedder")

_provider_available: dict[str, Optional[bool]] = {
    "ollama": None,
    "openai": None,
}
_last_embed_dims: dict[str, int] = {
    "ollama": 768,
    "openai": 1536,
}
_embed_dim_lock = asyncio.Lock()

MAX_CHARS = 20000

OPENAI_EMBED_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


def reset_runtime_state():
    """Reset runtime health cache after settings/provider changes."""
    _provider_available["ollama"] = None
    _provider_available["openai"] = None
    _last_embed_dims["openai"] = OPENAI_EMBED_DIMS.get(
        settings.openai_embed_model, 1536
    )


def _preferred_provider() -> str:
    return settings.selected_provider


def get_expected_embedding_dim() -> int:
    """Expected embedding dimension for the active provider."""
    if _preferred_provider() == "openai":
        return OPENAI_EMBED_DIMS.get(settings.openai_embed_model, 1536)
    dim = _last_embed_dims.get("ollama", 768)
    return dim if dim > 0 else 768


async def _set_last_embed_dim(provider: str, dim: int):
    async with _embed_dim_lock:
        _last_embed_dims[provider] = dim


def _truncate_text(text: str) -> str:
    if len(text) <= MAX_CHARS:
        return text
    half = MAX_CHARS // 2
    return text[:half] + "\n...\n" + text[-half:]


def _fallback_summary(text: str) -> str:
    clean = (text or "").strip()
    if not clean:
        return ""
    snippet = clean[:200]
    return snippet if len(clean) <= 200 else snippet + "..."


async def get_embedding(text: str) -> np.ndarray:
    """Generate embedding using only the selected provider."""
    provider = _preferred_provider()

    if not text or not text.strip():
        return np.zeros(get_expected_embedding_dim(), dtype=np.float32)

    text = _truncate_text(text)

    try:
        if provider == "openai":
            emb = await _embed_openai(text)
        else:
            emb = await _embed_ollama(text)
        _provider_available[provider] = True
        return emb
    except Exception as e:
        _provider_available[provider] = False
        logger.error(f"{provider} embedding failed: {e}")
        return np.zeros(get_expected_embedding_dim(), dtype=np.float32)


async def get_embedding_matching_dim(text: str, target_dim: int) -> np.ndarray:
    """Generate embedding and resize to target_dim if needed."""
    emb = await get_embedding(text)
    if emb.shape[0] == target_dim:
        return emb
    if emb.shape[0] < target_dim:
        return np.pad(emb, (0, target_dim - emb.shape[0]), mode="constant")
    return emb[:target_dim]


async def _embed_ollama(text: str) -> np.ndarray:
    import ollama as ol

    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None,
        lambda: ol.embed(
            model=settings.ollama_embed_model,
            input=text,
        ),
    )

    if hasattr(response, "embeddings"):
        vec = response.embeddings[0]
    elif isinstance(response, dict) and "embeddings" in response:
        vec = response["embeddings"][0]
    else:
        vec = response.get("embedding", response)

    arr = np.array(vec, dtype=np.float32)
    await _set_last_embed_dim("ollama", len(arr))
    return arr


async def _embed_openai(text: str) -> np.ndarray:
    if not settings.openai_api_key:
        raise RuntimeError("OpenAI provider selected but OPENAI_API_KEY is empty")

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.embeddings.create(
        model=settings.openai_embed_model,
        input=text,
    )
    vec = response.data[0].embedding
    arr = np.array(vec, dtype=np.float32)
    await _set_last_embed_dim("openai", len(arr))
    return arr


async def generate_summary(text: str) -> str:
    """Generate a short summary using the selected provider."""
    if not text or len(text.strip()) < 50:
        return _fallback_summary(text)

    snippet = text[:3000]
    provider = _preferred_provider()

    if provider == "openai":
        if not settings.openai_api_key:
            return _fallback_summary(text)
        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=settings.openai_api_key)
            response = await client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Summarize this document in 1-2 sentences:\n\n"
                            f"{snippet}"
                        ),
                    }
                ],
                max_tokens=100,
            )
            content = response.choices[0].message.content or ""
            return content[:300]
        except Exception as e:
            logger.warning(f"OpenAI summary failed: {e}")
            return _fallback_summary(text)

    try:
        import ollama as ol

        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: ol.chat(
                model=settings.ollama_llm_model,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "Summarize this document in 1-2 sentences:\n\n"
                            f"{snippet}"
                        ),
                    }
                ],
            ),
        )
        if hasattr(response, "message"):
            return (response.message.content or "")[:300]
        return (response.get("message", {}).get("content", "") or "")[:300]
    except Exception as e:
        logger.warning(f"Ollama summary failed: {e}")
        return _fallback_summary(text)
