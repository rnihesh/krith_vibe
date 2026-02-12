"""
SEFS Settings — runtime configuration persistence and provider testing.
"""

from __future__ import annotations
import logging

from app.config import settings
from app import db

logger = logging.getLogger("sefs.settings")

SETTINGS_KEYS = [
    "provider",
    "ollama_host",
    "ollama_embed_model",
    "ollama_llm_model",
    "openai_api_key",
    "openai_model",
    "openai_embed_model",
    "root_folder",
]


async def get_settings() -> dict:
    """Get all settings, merging DB overrides with defaults."""
    stored = await db.get_all_settings()
    stored_openai_key = (stored.get("openai_api_key") or "").strip()
    return {
        "provider": stored.get("provider", settings.selected_provider),
        "ollama_host": stored.get("ollama_host", settings.ollama_host),
        "ollama_embed_model": stored.get(
            "ollama_embed_model", settings.ollama_embed_model
        ),
        "ollama_llm_model": stored.get("ollama_llm_model", settings.ollama_llm_model),
        # Never return API key to frontend.
        "openai_api_key": "",
        "openai_api_key_set": bool(stored_openai_key),
        "openai_model": stored.get("openai_model", settings.openai_model),
        "openai_embed_model": stored.get(
            "openai_embed_model", settings.openai_embed_model
        ),
        "root_folder": stored.get("root_folder", settings.root_folder),
    }


async def save_settings(data: dict) -> dict:
    """Save settings to DB and update live config."""
    provider = str(data.get("provider", settings.selected_provider)).strip().lower()
    if provider not in {"ollama", "openai"}:
        provider = settings.selected_provider
    data["provider"] = provider

    # Detect if root_folder is changing
    new_root = data.get("root_folder")
    root_changing = False
    if new_root and str(new_root).strip():
        from pathlib import Path

        new_root_resolved = Path(new_root).expanduser().resolve()
        if new_root_resolved != settings.root_path:
            root_changing = True
            data["root_folder"] = str(new_root_resolved)

    to_store = {
        k: str(v) for k, v in data.items() if k in SETTINGS_KEYS and v is not None
    }
    await db.set_settings_bulk(to_store)

    # Update live runtime config (except root_folder which is handled by switch)
    settings.update_from_dict(
        {k: v for k, v in data.items() if k != "root_folder" or not root_changing}
    )

    # Reset embedding runtime cache so provider/model switches apply immediately
    from app import embedder

    embedder.reset_runtime_state()

    logger.info(f"Settings updated: provider={provider}")

    # If root folder changed, trigger the full switch (DB + watcher + rescan)
    if root_changing:
        from app.main import switch_root_folder

        await switch_root_folder(data["root_folder"])

    return await get_settings()


async def test_connection(data: dict) -> dict:
    """Test if the configured provider is reachable."""
    provider = data.get("provider", "ollama")

    if provider == "ollama":
        host = data.get("ollama_host", settings.ollama_host)
        try:
            import httpx

            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{host}/api/tags")
                if resp.status_code == 200:
                    models = resp.json().get("models", [])
                    model_names = [m.get("name", "") for m in models]
                    return {
                        "success": True,
                        "message": f"Connected to Ollama ({len(models)} models available)",
                        "models": model_names,
                    }
                return {
                    "success": False,
                    "message": f"Ollama returned {resp.status_code}",
                }
        except Exception as e:
            return {"success": False, "message": f"Cannot reach Ollama: {e}"}

    elif provider == "openai":
        # Use provided key first; otherwise use saved key from DB only (not env default).
        api_key = (data.get("openai_api_key") or "").strip()
        if not api_key:
            stored = await db.get_all_settings()
            api_key = (stored.get("openai_api_key") or "").strip()
        if not api_key:
            return {"success": False, "message": "No OpenAI API key provided"}
        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=api_key)
            models = await client.models.list()
            return {
                "success": True,
                "message": "Connected to OpenAI",
            }
        except Exception as e:
            return {"success": False, "message": f"OpenAI error: {e}"}

    return {"success": False, "message": f"Unknown provider: {provider}"}
