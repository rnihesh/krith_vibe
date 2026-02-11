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
    openai_api_key: str = ""
    ollama_host: str = "http://localhost:11434"
    ollama_embed_model: str = "nomic-embed-text"
    ollama_llm_model: str = "llama3"
    root_folder: str = "~/sefs_root"
    host: str = "0.0.0.0"
    port: int = 8484

    @property
    def root_path(self) -> Path:
        return Path(self.root_folder).expanduser().resolve()

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
