"""
SEFS Clustering Engine — HDBSCAN on original embeddings + UMAP for visualization.

Key design: HDBSCAN runs on high-dimensional embeddings with cosine metric
for accurate semantic clustering. UMAP-2D is used ONLY for visualization
coordinates, never for clustering decisions.
"""

from __future__ import annotations
import logging
import numpy as np
from typing import Optional

logger = logging.getLogger("sefs.clusterer")

# Minimum files needed before clustering is meaningful
MIN_FILES_FOR_CLUSTERING = 3

# Cosine similarity threshold for assigning noise points to clusters.
# Below this, noise stays in "Uncategorised" instead of being force-assigned.
NOISE_SIMILARITY_THRESHOLD = 0.40

# For small collections, skip HDBSCAN and use agglomerative directly
SMALL_COLLECTION_THRESHOLD = 25


def cluster_embeddings(
    embeddings: np.ndarray,
    min_cluster_size: int = 2,
    min_samples: int = 2,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Cluster embeddings using HDBSCAN on the ORIGINAL high-dimensional
    embeddings (cosine metric), then project to 2D with UMAP for viz only.

    Returns:
        labels: array of cluster IDs (-1 = uncategorised)
        coords_2d: (N, 2) array of UMAP coordinates for visualization
    """
    n = len(embeddings)
    logger.info(f"Clustering {n} embeddings (dim={embeddings.shape[1]})")

    if n < MIN_FILES_FOR_CLUSTERING:
        labels = np.zeros(n, dtype=int)
        coords = _simple_2d(embeddings)
        return labels, coords

    # ── Step 1: Cluster on ORIGINAL embeddings (high-dimensional) ──
    if n <= SMALL_COLLECTION_THRESHOLD:
        # For small collections, HDBSCAN is too conservative.
        # Use agglomerative clustering with cosine distances directly.
        logger.info(
            f"Small collection ({n} files), using agglomerative clustering directly"
        )
        labels = _agglomerative_fallback(embeddings)
    else:
        labels = _run_hdbscan(embeddings, min_cluster_size, min_samples)

        # If HDBSCAN produced only noise (all -1), fall back to agglomerative
        if (labels == -1).all():
            logger.info("HDBSCAN found only noise, using agglomerative fallback")
            labels = _agglomerative_fallback(embeddings)

        # Smart noise assignment: only assign if cosine-similar enough
        labels = _assign_noise_smart(labels, embeddings)

    # ── Step 2: UMAP 2D projection for VISUALIZATION ONLY ──
    coords_2d = _umap_2d(embeddings, n)

    n_clusters = len(set(labels) - {-1})
    n_noise = (labels == -1).sum()
    logger.info(f"Clustering result: {n_clusters} clusters, {n_noise} uncategorised")

    return labels, coords_2d.astype(np.float32)


def _run_hdbscan(
    embeddings: np.ndarray,
    min_cluster_size: int = 2,
    min_samples: int = 2,
) -> np.ndarray:
    """Run HDBSCAN on original embeddings with cosine metric."""
    try:
        import hdbscan

        # Adaptive min_cluster_size: at least 2, scale with collection size
        n = len(embeddings)
        adaptive_min_size = max(min_cluster_size, 2)
        adaptive_min_samples = max(min_samples, 2)

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=adaptive_min_size,
            min_samples=adaptive_min_samples,
            metric="euclidean",  # on L2-normalized vectors = cosine
            cluster_selection_method="eom",
            cluster_selection_epsilon=0.0,
        )

        # L2-normalize embeddings so euclidean distance ≈ cosine distance
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        normalized = embeddings / norms

        labels = clusterer.fit_predict(normalized)
        return labels

    except Exception as e:
        logger.warning(f"HDBSCAN failed: {e}")
        return _agglomerative_fallback(embeddings)


def _agglomerative_fallback(embeddings: np.ndarray) -> np.ndarray:
    """Agglomerative clustering with cosine distances and automatic
    cluster count via distance threshold. Singletons become noise (-1)."""
    try:
        from sklearn.cluster import AgglomerativeClustering
        from sklearn.metrics.pairwise import cosine_distances

        n = len(embeddings)
        dist_matrix = cosine_distances(embeddings)

        # distance_threshold=0.52 ≈ cosine similarity threshold of 0.48
        # This catches pairs like ML docs (sim=0.49) but not recipes (sim=0.28)
        clustering = AgglomerativeClustering(
            n_clusters=None,
            metric="precomputed",
            linkage="average",
            distance_threshold=0.52,
        )
        labels = clustering.fit_predict(dist_matrix)

        # Demote singleton clusters to noise (-1) → "Uncategorised"
        from collections import Counter

        counts = Counter(labels)
        for i in range(len(labels)):
            if counts[labels[i]] == 1:
                labels[i] = -1

        # Re-number clusters to be contiguous starting from 0
        unique_labels = sorted(set(labels) - {-1})
        remap = {old: new for new, old in enumerate(unique_labels)}
        remap[-1] = -1
        labels = np.array([remap[lbl] for lbl in labels])

        return labels
    except Exception as e:
        logger.warning(f"Agglomerative fallback failed: {e}")
        return np.zeros(len(embeddings), dtype=int)


def _assign_noise_smart(labels: np.ndarray, embeddings: np.ndarray) -> np.ndarray:
    """Assign noise points to nearest cluster ONLY if cosine similarity
    exceeds the threshold. Otherwise, keep as noise (-1) for 'Uncategorised'."""
    noise_mask = labels == -1
    if not noise_mask.any():
        return labels

    # If ALL are noise, nothing to assign to
    if noise_mask.all():
        return np.zeros_like(labels)

    # Compute cluster centroids in embedding space
    labeled_mask = ~noise_mask
    unique_labels = np.unique(labels[labeled_mask])
    centroids = {}
    for cid in unique_labels:
        mask = labels == cid
        centroids[int(cid)] = embeddings[mask].mean(axis=0)

    for i in np.where(noise_mask)[0]:
        emb = embeddings[i]
        best_sim = -1
        best_cid = -1

        for cid, centroid in centroids.items():
            # Cosine similarity
            sim = np.dot(emb, centroid) / (
                np.linalg.norm(emb) * np.linalg.norm(centroid) + 1e-10
            )
            if sim > best_sim:
                best_sim = sim
                best_cid = cid

        if best_sim >= NOISE_SIMILARITY_THRESHOLD:
            labels[i] = best_cid
            logger.debug(
                f"Noise point {i} assigned to cluster {best_cid} (sim={best_sim:.3f})"
            )
        else:
            logger.debug(
                f"Noise point {i} stays uncategorised (best sim={best_sim:.3f} < {NOISE_SIMILARITY_THRESHOLD})"
            )
            # Keep as -1; pipeline will put it in "Uncategorised"

    return labels


def _umap_2d(embeddings: np.ndarray, n: int) -> np.ndarray:
    """UMAP projection to 2D for visualization only."""
    try:
        import umap

        n_neighbors = min(15, n - 1) if n > 2 else 2
        reducer = umap.UMAP(
            n_components=2,
            n_neighbors=n_neighbors,
            min_dist=0.1,
            metric="cosine",
            random_state=42,
        )
        return reducer.fit_transform(embeddings)
    except Exception as e:
        logger.warning(f"UMAP failed: {e}, using PCA fallback")
        return _pca_2d(embeddings)


def _pca_2d(embeddings: np.ndarray) -> np.ndarray:
    """Simple PCA to 2D as fallback."""
    from sklearn.decomposition import PCA

    pca = PCA(n_components=2, random_state=42)
    return pca.fit_transform(embeddings)


def _simple_2d(embeddings: np.ndarray) -> np.ndarray:
    """Simple 2D layout for very small collections."""
    n = len(embeddings)
    if n <= 1:
        return np.array([[0.0, 0.0]])
    if n == 2:
        return np.array([[0.0, 0.0], [1.0, 0.0]])
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.column_stack([np.cos(angles), np.sin(angles)])


def compute_centroids(
    embeddings: np.ndarray, labels: np.ndarray
) -> dict[int, np.ndarray]:
    """Compute centroid embedding for each cluster."""
    centroids = {}
    for cid in np.unique(labels):
        if cid < 0:
            continue
        mask = labels == cid
        centroids[int(cid)] = embeddings[mask].mean(axis=0)
    return centroids
