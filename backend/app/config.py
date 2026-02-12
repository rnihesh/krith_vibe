"""
SEFS Configuration — loaded from .env
"""

from __future__ import annotations
import os
from pathlib import Path
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class Settings(BaseSettings):
    provider: str = "ollama"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_embed_model: str = "text-embedding-3-small"
    ollama_host: str = "http://localhost:11434"
    ollama_embed_model: str = "nomic-embed-text"
    ollama_llm_model: str = "llama3.2"
    root_folder: str = "~/Nihesh/sefs_root"
    host: str = "0.0.0.0"
    port: int = 8484

    @property
    def root_path(self) -> Path:
        return Path(self.root_folder).expanduser().resolve()

    @property
    def selected_provider(self) -> str:
        return "openai" if self.provider.lower() == "openai" else "ollama"

    def update_from_dict(self, data: dict):
        """Update runtime settings from a dict (e.g. from saved settings)."""
        field_map = {
            "openai_api_key": "openai_api_key",
            "openai_model": "openai_model",
            "openai_embed_model": "openai_embed_model",
            "ollama_host": "ollama_host",
            "ollama_embed_model": "ollama_embed_model",
            "ollama_llm_model": "ollama_llm_model",
            "root_folder": "root_folder",
        }
        if "provider" in data:
            provider = str(data["provider"]).strip().lower()
            if provider in {"ollama", "openai"}:
                object.__setattr__(self, "provider", provider)
        for key, attr in field_map.items():
            if key in data and data[key] is not None:
                object.__setattr__(self, attr, data[key])

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
