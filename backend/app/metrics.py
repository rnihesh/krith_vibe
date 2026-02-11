"""
SEFS Metrics — pipeline performance tracking.
"""

from __future__ import annotations
import time
import logging
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger("sefs.metrics")

MAX_SAMPLES = 100


@dataclass
class PipelineMetrics:
    extraction_ms: deque = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    embedding_ms: deque = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    clustering_ms: deque = field(default_factory=lambda: deque(maxlen=MAX_SAMPLES))
    total_files_processed: int = 0

    def record_extraction(self, ms: float):
        self.extraction_ms.append(ms)

    def record_embedding(self, ms: float):
        self.embedding_ms.append(ms)

    def record_clustering(self, ms: float):
        self.clustering_ms.append(ms)

    def get_summary(self) -> dict:
        def avg(dq: deque) -> float:
            return round(sum(dq) / len(dq), 1) if dq else 0.0

        return {
            "avg_extraction_ms": avg(self.extraction_ms),
            "avg_embedding_ms": avg(self.embedding_ms),
            "last_clustering_ms": round(self.clustering_ms[-1], 1) if self.clustering_ms else 0.0,
            "total_files_processed": self.total_files_processed,
            "extraction_count": len(self.extraction_ms),
            "embedding_count": len(self.embedding_ms),
            "clustering_count": len(self.clustering_ms),
        }


# Global metrics instance
metrics = PipelineMetrics()


class Timer:
    """Async-compatible context manager for timing pipeline stages."""

    def __init__(self):
        self._start: float = 0
        self.elapsed_ms: float = 0

    def __enter__(self):
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_):
        self.elapsed_ms = (time.perf_counter() - self._start) * 1000

    async def __aenter__(self):
        self._start = time.perf_counter()
        return self

    async def __aexit__(self, *_):
        self.elapsed_ms = (time.perf_counter() - self._start) * 1000
