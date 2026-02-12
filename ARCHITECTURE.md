# SEFS Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SEFS ARCHITECTURE                                  │
│                  Semantic Entropy File System                                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    React Frontend (TypeScript)                        │  │
│  │                      Vite + Tailwind CSS                              │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                        │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐    │  │
│  │  │   GraphView     │  │  SpatialView    │  │   ChatPanel      │    │  │
│  │  │  (Force Graph)  │  │  (UMAP + D3)    │  │  (RAG Chat)      │    │  │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘    │  │
│  │                                                                        │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐    │  │
│  │  │    Sidebar      │  │   EventFeed     │  │  MetricsPanel    │    │  │
│  │  │  (Metadata)     │  │  (Live Events)  │  │  (Performance)   │    │  │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘    │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │  │
│  │  │              WebSocket Client (useWebSocket)                     │ │  │
│  │  │              Real-time event streaming                           │ │  │
│  │  └─────────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Tauri v2 Desktop Shell (Rust)                      │  │
│  │  • Auto-spawns Python backend on startup                             │  │
│  │  • Desktop notifications (tauri-plugin-process)                      │  │
│  │  • Native window management                                          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ REST API + WebSocket
                                    │ (HTTP/WS on :8484)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          APPLICATION LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                   FastAPI Backend (Python 3.10+)                      │  │
│  │                        main.py + uvicorn                              │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                        │  │
│  │  REST Endpoints:                    WebSocket:                        │  │
│  │  • GET  /api/status                 • /ws (live events)              │  │
│  │  • GET  /api/files                  • ConnectionManager              │  │
│  │  • GET  /api/clusters               • Real-time broadcasts           │  │
│  │  • GET  /api/graph                                                    │  │
│  │  • GET  /api/search?q=...                                            │  │
│  │  • POST /api/rescan                                                   │  │
│  │  • POST /api/chat                                                     │  │
│  │  • GET  /api/file/{id}/related                                       │  │
│  │  • GET  /api/file/{id}/compare/{id}                                  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROCESSING PIPELINE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        pipeline.py                                    │  │
│  │              Orchestrates: Extract → Embed → Cluster                 │  │
│  │                          → Name → Sync                                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  watcher.py │  │extractor.py │  │embedder.py  │  │clusterer.py │      │
│  │             │  │             │  │             │  │             │      │
│  │ • watchdog  │  │ • PyMuPDF   │  │ • Ollama    │  │ • HDBSCAN   │      │
│  │ • FSEvents  │  │ • docx      │  │ • OpenAI    │  │ • UMAP      │      │
│  │ • Debounce  │  │ • markdown  │  │ • Fallback  │  │ • Cosine    │      │
│  │   (1.5s)    │  │ • CSV/TXT   │  │   handling  │  │   metric    │      │
│  │             │  │             │  │             │  │             │      │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  namer.py   │  │   sync.py   │  │  chat.py    │  │ metrics.py  │      │
│  │             │  │             │  │             │  │             │      │
│  │ • LLM       │  │ • shutil    │  │ • RAG       │  │ • Timers    │      │
│  │   naming    │  │ • Sync lock │  │ • Context   │  │ • Counters  │      │
│  │ • Keyword   │  │ • Collision │  │   retrieval │  │ • Pipeline  │      │
│  │   fallback  │  │   handling  │  │ • Streaming │  │   metrics   │      │
│  │             │  │             │  │             │  │             │      │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    ReclusterScheduler                                 │  │
│  │  • Debounces recluster requests (2s)                                 │  │
│  │  • Cooldown period (5s) prevents spurious reclustering              │  │
│  │  • Single-task execution with async lock                            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        db.py (aiosqlite)                              │  │
│  │                         SQLite Database                               │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                        │  │
│  │  Tables:                                                              │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │ files                                                           │  │  │
│  │  │ • id, filename, original_path, current_path                    │  │  │
│  │  │ • content_hash, embedding (BLOB), summary                      │  │  │
│  │  │ • file_type, size_bytes, word_count, page_count               │  │  │
│  │  │ • cluster_id, umap_x, umap_y                                  │  │  │
│  │  │ • created_at, modified_at                                     │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │ clusters                                                        │  │  │
│  │  │ • id, name, description, folder_path                           │  │  │
│  │  │ • centroid (BLOB), file_count, created_at                     │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │ events                                                          │  │  │
│  │  │ • id, file_id, event_type, filename, timestamp                │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │ settings                                                        │  │  │
│  │  │ • key, value (JSON)                                            │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────┐         ┌─────────────────────────┐           │
│  │   Ollama (Local)        │         │   OpenAI API            │           │
│  │                         │         │                         │           │
│  │  • nomic-embed-text     │         │  • text-embedding-3-*   │           │
│  │    (768-dim)            │         │    (1536/3072-dim)      │           │
│  │  • llama3.2             │         │  • gpt-4o-mini          │           │
│  │  • localhost:11434      │         │  • API key required     │           │
│  └─────────────────────────┘         └─────────────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FILE SYSTEM LAYER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      ROOT_FOLDER                                      │  │
│  │                  (~/sefs_root)                                 │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                        │  │
│  │  ├── Cluster_Name_1/                                                  │  │
│  │  │   ├── file1.pdf                                                    │  │
│  │  │   └── file2.docx                                                   │  │
│  │  │                                                                     │  │
│  │  ├── Cluster_Name_2/                                                  │  │
│  │  │   ├── file3.txt                                                    │  │
│  │  │   └── file4.md                                                     │  │
│  │  │                                                                     │  │
│  │  └── Uncategorised/                                                   │  │
│  │      └── outlier.csv                                                  │  │
│  │                                                                        │  │
│  │  • Bidirectional sync with OS (Finder/Explorer)                      │  │
│  │  • Real-time monitoring via watchdog                                 │  │
│  │  • Collision handling (file_1.txt, file_2.txt)                       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                          DATA FLOW DIAGRAM                                   │
└─────────────────────────────────────────────────────────────────────────────┘

  User drops file.pdf into ROOT_FOLDER
              │
              ▼
  ┌───────────────────────────────────────┐
  │  watchdog detects (1.5s debounce)     │
  └───────────────────────────────────────┘
              │
              ▼
  ┌───────────────────────────────────────┐
  │  pipeline.process_file()               │
  │  ├─ extractor.extract()                │
  │  │  └─ PyMuPDF/docx/markdown           │
  │  ├─ embedder.get_embedding()           │
  │  │  └─ Ollama/OpenAI                   │
  │  ├─ embedder.generate_summary()        │
  │  │  └─ LLM (llama3.2/gpt-4o-mini)      │
  │  └─ db.upsert_file()                   │
  └───────────────────────────────────────┘
              │
              ▼
  ┌───────────────────────────────────────┐
  │  pipeline.try_incremental_assign()     │
  │  • Cosine similarity to centroids      │
  │  • Threshold: 0.40                     │
  │  • If match → assign to cluster        │
  │  • If no match → trigger recluster     │
  └───────────────────────────────────────┘
              │
              ▼ (if recluster needed)
  ┌───────────────────────────────────────┐
  │  ReclusterScheduler (2s debounce)      │
  └───────────────────────────────────────┘
              │
              ▼
  ┌───────────────────────────────────────┐
  │  pipeline.run_clustering()             │
  │  ├─ Normalize embedding dimensions     │
  │  ├─ clusterer.cluster_embeddings()     │
  │  │  ├─ HDBSCAN (high-dim, cosine)     │
  │  │  ├─ Agglomerative fallback         │
  │  │  └─ UMAP 2D (visualization only)   │
  │  ├─ namer.generate_cluster_name()      │
  │  │  └─ LLM with keyword fallback       │
  │  ├─ db.upsert_cluster()                │
  │  └─ sync.sync_files_to_folders()       │
  │     ├─ Create cluster folders          │
  │     ├─ Move files (shutil)             │
  │     ├─ Handle collisions               │
  │     └─ Cleanup empty dirs              │
  └───────────────────────────────────────┘
              │
              ▼
  ┌───────────────────────────────────────┐
  │  WebSocket broadcast                   │
  │  • reclustering_end event              │
  │  • cluster_count, total_moves          │
  └───────────────────────────────────────┘
              │
              ▼
  ┌───────────────────────────────────────┐
  │  Frontend receives event               │
  │  ├─ Refetch graph data                 │
  │  ├─ Update visualization               │
  │  ├─ Show desktop notification          │
  │  └─ Update event feed                  │
  └───────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                       KEY DESIGN PATTERNS                                    │
└─────────────────────────────────────────────────────────────────────────────┘

1. SYNC LOCK PATTERN (sync.py)
   • Prevents watcher from re-triggering on system-initiated moves
   • Set lock → move files → 2.5s delay → release lock
   • Recently-synced paths tracked with 5s TTL

2. DEBOUNCED PROCESSING (watcher.py, pipeline.py)
   • File events: 1.5s debounce window
   • Recluster requests: 2s debounce + 5s cooldown
   • Single-task execution with async locks

3. GRACEFUL DEGRADATION (embedder.py, clusterer.py)
   • Ollama → OpenAI → zero vector
   • HDBSCAN → Agglomerative → simple layout
   • LLM naming → keyword extraction

4. INCREMENTAL CLUSTERING (pipeline.py)
   • New files assigned to existing clusters via cosine similarity
   • Threshold: 0.40 (same as noise assignment)
   • Full recluster only when no good match

5. DIMENSION NORMALIZATION (pipeline.py)
   • Handles Ollama (768-dim) vs OpenAI (1536-dim)
   • Re-embeds or pads/truncates to target dimension
   • Prevents clustering failures from mixed dimensions

6. RECORD DEDUPLICATION (pipeline.py)
   • Detects stale DB rows from manual file moves
   • Removes orphan records (file gone from disk)
   • Keeps best record based on path existence

7. WEBSOCKET BROADCASTING (main.py)
   • Real-time event stream to all connected clients
   • Events: file_added, file_removed, reclustering_start/end
   • Automatic reconnection on disconnect


┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLUSTERING ALGORITHM                                   │
└─────────────────────────────────────────────────────────────────────────────┘

Input: N files with embeddings (768 or 1536 dimensions)

Step 1: Normalize dimensions
  • Target: provider's native dimension (Ollama=768, OpenAI=1536)
  • Re-embed outliers or pad/truncate

Step 2: Cluster on HIGH-DIMENSIONAL embeddings
  • If N ≤ 25: Agglomerative (distance_threshold=0.45)
  • If N > 25: HDBSCAN (min_cluster_size=2, metric=euclidean on L2-normalized)
  • Cosine similarity via L2-normalization + euclidean distance

Step 3: Smart noise assignment
  • Compute cluster centroids
  • For each noise point (-1):
    - Find closest centroid by cosine similarity
    - If similarity ≥ 0.40 → assign to cluster
    - Else → keep as noise → "Uncategorised" folder

Step 4: UMAP 2D projection (VISUALIZATION ONLY)
  • n_neighbors=15, min_dist=0.1, metric=cosine
  • Scale to [-400, 400] for graph layout
  • Never used for clustering decisions

Step 5: Generate cluster names
  • Extract text from up to 5 files per cluster
  • LLM prompt: "Generate a 2-3 word folder name"
  • Fallback: keyword extraction from filenames

Step 6: Sync to OS
  • Create cluster folders
  • Move files with collision handling
  • Update DB with new paths
  • Cleanup empty directories

Output: Semantic folder structure + visualization coordinates
```
