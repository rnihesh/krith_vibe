"""
SEFS Folder Namer — generates human-readable folder names for clusters.
Uses Ollama LLM when available, falls back to keyword extraction.
"""

from __future__ import annotations
import logging
import re
from app.config import settings

logger = logging.getLogger("sefs.namer")


async def generate_cluster_name(
    texts: list[str], existing_names: list[str] = None
) -> str:
    """Generate a descriptive folder name from representative document texts."""
    if not texts:
        return "Miscellaneous"

    # Build a snippet from each document
    snippets = []
    for t in texts[:5]:  # max 5 docs
        snippet = t[:500].strip()
        if snippet:
            snippets.append(snippet)

    if not snippets:
        return "Miscellaneous"

    combined = "\n---\n".join(snippets)
    existing_str = ", ".join(existing_names) if existing_names else "none"

    prompt = f"""Based on these document excerpts from a folder of related files, generate a short descriptive folder name (2-4 words, use underscores between words, no special characters).

Existing folder names (avoid duplicates): {existing_str}

Document excerpts:
{combined}

Reply with ONLY the folder name, nothing else. Example: Machine_Learning_Research"""

    # Try Ollama
    try:
        import ollama as ol

        response = ol.chat(
            model=settings.ollama_llm_model,
            messages=[{"role": "user", "content": prompt}],
        )
        name = ""
        if hasattr(response, "message"):
            name = response.message.content.strip()
        elif isinstance(response, dict):
            name = response.get("message", {}).get("content", "").strip()
        name = _sanitize_name(name)
        if name and name.lower() != "miscellaneous":
            return name
    except Exception as e:
        logger.warning(f"Ollama naming failed: {e}")

    # Try OpenAI
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0.3,
        )
        name = response.choices[0].message.content.strip()
        name = _sanitize_name(name)
        if name:
            return name
    except Exception as e:
        logger.warning(f"OpenAI naming failed: {e}")

    # Fallback: keyword extraction
    return _keyword_name(snippets)


def _sanitize_name(name: str) -> str:
    """Clean up a generated name for filesystem use."""
    # Remove quotes, dots, special chars
    name = name.strip().strip("\"'`.")
    # Replace spaces and hyphens with underscores
    name = re.sub(r"[\s\-]+", "_", name)
    # Remove non-alphanumeric except underscores
    name = re.sub(r"[^a-zA-Z0-9_]", "", name)
    # Trim length
    name = name[:50]
    # Remove leading/trailing underscores
    name = name.strip("_")
    return name if name else "Misc"


def _keyword_name(snippets: list[str]) -> str:
    """Extract top keywords from snippets to form a folder name."""
    from collections import Counter
    import re

    stopwords = {
        "the",
        "a",
        "an",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "shall",
        "can",
        "need",
        "dare",
        "ought",
        "used",
        "to",
        "of",
        "in",
        "for",
        "on",
        "with",
        "at",
        "by",
        "from",
        "as",
        "into",
        "through",
        "during",
        "before",
        "after",
        "above",
        "below",
        "between",
        "out",
        "off",
        "over",
        "under",
        "again",
        "further",
        "then",
        "once",
        "here",
        "there",
        "when",
        "where",
        "why",
        "how",
        "all",
        "both",
        "each",
        "few",
        "more",
        "most",
        "other",
        "some",
        "such",
        "no",
        "nor",
        "not",
        "only",
        "own",
        "same",
        "so",
        "than",
        "too",
        "very",
        "just",
        "because",
        "but",
        "and",
        "or",
        "if",
        "while",
        "this",
        "that",
        "these",
        "those",
        "it",
        "its",
        "i",
        "me",
        "my",
        "we",
        "our",
        "you",
        "your",
        "he",
        "his",
        "she",
        "her",
        "they",
        "their",
        "what",
        "which",
        "who",
        "whom",
    }

    all_text = " ".join(snippets).lower()
    words = re.findall(r"[a-z]{3,}", all_text)
    filtered = [w for w in words if w not in stopwords]
    counts = Counter(filtered)
    top = [w for w, _ in counts.most_common(3)]
    if top:
        return "_".join(w.capitalize() for w in top)
    return "Misc"
