"""
SEFS Clustering Engine — HDBSCAN clustering + UMAP for 2D projection.
"""

from __future__ import annotations
import logging
import numpy as np
from typing import Optional
from datetime import datetime

logger = logging.getLogger("sefs.clusterer")

# Minimum files needed before clustering is meaningful
MIN_FILES_FOR_CLUSTERING = 3


def cluster_embeddings(
    embeddings: np.ndarray,
    min_cluster_size: int = 2,
    min_samples: int = 1,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Cluster embeddings using HDBSCAN and project to 2D with UMAP.

    Returns:
        labels: array of cluster IDs (-1 = noise/unclustered)
        coords_2d: (N, 2) array of UMAP coordinates
    """
    n = len(embeddings)

    if n < MIN_FILES_FOR_CLUSTERING:
        labels = np.zeros(n, dtype=int)
        coords = _simple_2d(embeddings)
        return labels, coords

    # UMAP dimensionality reduction
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
        coords_2d = reducer.fit_transform(embeddings)
    except Exception as e:
        logger.warning(f"UMAP failed: {e}, using PCA fallback")
        coords_2d = _pca_2d(embeddings)

    # HDBSCAN clustering
    try:
        import hdbscan

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=max(2, min_cluster_size),
            min_samples=min_samples,
            metric="euclidean",
            cluster_selection_method="eom",
        )
        labels = clusterer.fit_predict(coords_2d)
    except Exception as e:
        logger.warning(f"HDBSCAN failed: {e}, using simple clustering")
        labels = _simple_cluster(coords_2d)

    # Assign noise points (-1) to nearest cluster
    labels = _assign_noise(labels, coords_2d)

    return labels, coords_2d.astype(np.float32)


def _assign_noise(labels: np.ndarray, coords: np.ndarray) -> np.ndarray:
    """Assign noise points to the nearest cluster."""
    noise_mask = labels == -1
    if not noise_mask.any() or (labels == -1).all():
        # If all noise, put everything in cluster 0
        if (labels == -1).all():
            return np.zeros_like(labels)
        return labels

    labeled_mask = ~noise_mask
    labeled_coords = coords[labeled_mask]
    labeled_labels = labels[labeled_mask]

    for i in np.where(noise_mask)[0]:
        dists = np.linalg.norm(labeled_coords - coords[i], axis=1)
        nearest = np.argmin(dists)
        labels[i] = labeled_labels[nearest]

    return labels


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


def _simple_cluster(coords: np.ndarray) -> np.ndarray:
    """KMeans fallback clustering."""
    from sklearn.cluster import KMeans

    n = len(coords)
    k = max(1, min(n // 2, 10))
    if k <= 1:
        return np.zeros(n, dtype=int)
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    return km.fit_predict(coords)


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
