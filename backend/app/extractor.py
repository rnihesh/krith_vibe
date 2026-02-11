"""
SEFS Content Extractor — unified text extraction for PDF, TXT, MD, DOCX, CSV.
"""

from __future__ import annotations
import hashlib
import logging
from pathlib import Path
from dataclasses import dataclass

logger = logging.getLogger("sefs.extractor")

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".txt",
    ".md",
    ".markdown",
    ".docx",
    ".csv",
    ".text",
    ".rst",
}


@dataclass
class ExtractionResult:
    text: str
    word_count: int
    page_count: int
    file_type: str
    content_hash: str
    size_bytes: int


def is_supported(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_EXTENSIONS and not path.name.startswith(".")


def compute_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def extract(path: Path) -> ExtractionResult:
    """Extract text content from a file. Returns ExtractionResult."""
    suffix = path.suffix.lower()
    size = path.stat().st_size
    content_hash = compute_hash(path)

    if suffix == ".pdf":
        text, pages = _extract_pdf(path)
    elif suffix in (".txt", ".text", ".rst"):
        text = _extract_text(path)
        pages = 1
    elif suffix in (".md", ".markdown"):
        text = _extract_markdown(path)
        pages = 1
    elif suffix == ".docx":
        text, pages = _extract_docx(path)
    elif suffix == ".csv":
        text = _extract_csv(path)
        pages = 1
    else:
        text = ""
        pages = 0

    word_count = len(text.split()) if text else 0

    return ExtractionResult(
        text=text,
        word_count=word_count,
        page_count=pages,
        file_type=suffix.lstrip("."),
        content_hash=content_hash,
        size_bytes=size,
    )


def _extract_pdf(path: Path) -> tuple[str, int]:
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(str(path))
        pages = len(doc)
        parts = []
        for page in doc:
            parts.append(page.get_text())
        doc.close()
        return "\n".join(parts), pages
    except Exception as e:
        logger.error(f"PDF extraction failed for {path}: {e}")
        return "", 0


def _extract_text(path: Path) -> str:
    try:
        import chardet

        raw = path.read_bytes()
        detected = chardet.detect(raw)
        encoding = detected.get("encoding", "utf-8") or "utf-8"
        return raw.decode(encoding, errors="replace")
    except Exception as e:
        logger.error(f"Text extraction failed for {path}: {e}")
        return ""


def _extract_markdown(path: Path) -> str:
    try:
        import markdown
        import re

        raw = _extract_text(path)
        # Strip markdown syntax for cleaner semantic content
        html = markdown.markdown(raw)
        clean = re.sub(r"<[^>]+>", "", html)
        return clean
    except Exception as e:
        logger.error(f"Markdown extraction failed for {path}: {e}")
        return _extract_text(path)


def _extract_docx(path: Path) -> tuple[str, int]:
    try:
        from docx import Document

        doc = Document(str(path))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        # Rough page estimate
        total_chars = sum(len(p) for p in paragraphs)
        pages = max(1, total_chars // 3000)
        return "\n".join(paragraphs), pages
    except Exception as e:
        logger.error(f"DOCX extraction failed for {path}: {e}")
        return "", 0


def _extract_csv(path: Path) -> str:
    try:
        import pandas as pd

        df = pd.read_csv(str(path), nrows=200)
        parts = []
        parts.append(f"Columns: {', '.join(df.columns.tolist())}")
        parts.append(f"Rows: {len(df)}")
        parts.append(f"Sample data:\n{df.head(10).to_string()}")
        # Add column stats for numeric columns
        desc = df.describe(include="all").to_string()
        parts.append(f"Statistics:\n{desc}")
        return "\n".join(parts)
    except Exception as e:
        logger.error(f"CSV extraction failed for {path}: {e}")
        return ""
