# KIRO.md

Comprehensive guide for Kiro AI assistant when working with the SEFS codebase.

## Project Overview

**SEFS (Semantic Entropy File System)** is a self-organizing file manager that replaces static folder hierarchies with dynamic semantic clustering. Files are automatically analyzed, embedded, clustered by content similarity, and physically moved into semantically-named OS folders. A React frontend provides real-time 2D visualization (force-directed graph + UMAP spatial map) with live updates via WebSocket.

**Built for:** AI Week Hackathon (Problem Statement 3)

**Core Innovation:** Bidirectional OS-level sync — files are physically moved into semantic folders that sync with Finder/Explorer, not just visualized.

## Quick Start Commands

### Full Stack

```bash
chmod +x start.sh && ./start.sh
```

### Backend Only

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8484 --reload
```

### Frontend Only

```bash
cd frontend
npm install
npm run dev    # Vite dev server on :5173
```

### Desktop (Tauri v2)

```bash
cd frontend
npm run tauri:dev      # Dev mode with auto-reload
npm run tauri:build    # Production .app/.dmg bundle
```

### Tests

```bash
cd backend && pytest
```

## Architecture Overview

### Technology Stack

| Layer             | Technology                                               |
| ----------------- | -------------------------------------------------------- |
| **Backend**       | Python 3.10+, FastAPI, uvicorn                           |
| **Extraction**    | PyMuPDF, python-docx, markdown, pandas                   |
| **Embeddings**    | Ollama (nomic-embed-text) / OpenAI (text-embedding-3-\*) |
| **Clustering**    | HDBSCAN, UMAP, scikit-learn                              |
| **Database**      | SQLite (aiosqlite)                                       |
| **Frontend**      | React 18, TypeScript, Vite                               |
| **Visualization** | react-force-graph-2d, D3.js                              |
| **Styling**       | Tailwind CSS 4, Framer Motion                            |
| **Desktop**       | Tauri v2                                                 |

### Directory Structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI server, REST + WebSocket
│   │   ├── pipeline.py       # Orchestrates extract → embed → cluster → sync
│   │   ├── watcher.py        # watchdog file system monitor
│   │   ├── extractor.py      # Content extraction (PDF, DOCX, MD, CSV, TXT)
│   │   ├── embedder.py       # Ollama/OpenAI embedding generation
│   │   ├── clusterer.py      # HDBSCAN + UMAP clustering
│   │   ├── namer.py          # LLM-powered cluster naming
│   │   ├── sync.py           # OS-level file synchronization
│   │   ├── db.py             # SQLite database operations
│   │   ├── chat.py           # RAG chat with file context
│   │   ├── metrics.py        # Performance metrics tracking
│   │   ├── config.py         # Pydantic settings from .env
│   │   └── settings.py       # Runtime settings management
│   ├── pyproject.toml        # Python dependencies
│   └── sefs.db               # SQLite database
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main application component
│   │   ├── api.ts            # Backend API client
│   │   ├── types.ts          # TypeScript interfaces
│   │   ├── views/
│   │   │   ├── GraphView.tsx # Force-directed graph visualization
│   │   │   └── SpatialView.tsx # UMAP spatial map (D3 + Voronoi)
│   │   ├── components/
│   │   │   ├── Sidebar.tsx   # File/cluster metadata inspector
│   │   │   ├── EventFeed.tsx # Real-time event log
│   │   │   ├── ChatPanel.tsx # RAG chat interface
│   │   │   ├── MetricsPanel.tsx # Performance metrics display
│   │   │   ├── SettingsModal.tsx # Provider configuration
│   │   │   └── Toast.tsx     # Notification system
│   │   └── hooks/
│   │       ├── useWebSocket.ts # WebSocket connection management
│   │       └── useTheme.ts   # Dark/light theme toggle
│   ├── src-tauri/            # Tauri v2 desktop shell (Rust)
│   ├── package.json
│   └── vite.config.ts
│
├── README.md                 # User-facing documentation
├── CLAUDE.md                 # Claude Code guidance (original)
├── ARCHITECTURE.md           # Architecture diagrams (NEW)
└── KIRO.md                   # This file (NEW)
```

## Core Modules Deep Dive

### 1. Pipeline (pipeline.py)

**Purpose:** Orchestrates the full processing flow: extract → embed → cluster → name → sync → notify

**Key Functions:**

- `process_file(path)` — Process a single file (extract, embed, summarize, store)
- `remove_file(path)` — Remove file from DB with move detection
- `run_clustering()` — Full recluster: HDBSCAN → UMAP → LLM naming → OS sync
- `full_scan()` — Initial scan of root folder
- `try_incremental_assign(file_id)` — Assign new file to existing cluster without full recluster

**Key Patterns:**

- **Incremental clustering:** New files assigned via cosine similarity (threshold: 0.40)
- **Dimension normalization:** Handles Ollama (768-dim) vs OpenAI (1536-dim) embeddings
- **Record repair:** Deduplicates stale DB rows from manual file moves
- **Debounced reclustering:** 2s debounce + 5s cooldown prevents spurious reclusters

**Important Thresholds:**

- `INCREMENTAL_MAX = 5` — Max new files for incremental mode
- Cosine similarity threshold: `0.40` (same as clusterer's noise assignment)

### 2. Watcher (watcher.py)

**Purpose:** Monitors root folder for file changes using watchdog

**Key Features:**

- **Single-task debounce:** Collects pending paths, resets timer on each event, flushes all pending in one batch
- **Debounce window:** 1.5 seconds
- **Sync-lock awareness:** Ignores events when sync lock is active
- **Recently-synced paths:** Belt-and-suspenders guard against late FSEvents (5s TTL)

**Event Handling:**

- `on_created` → schedule change
- `on_modified` → schedule change
- `on_deleted` → schedule delete
- `on_moved` → schedule delete old + create new

**Ignored Paths:**

- Hidden files (starts with `.` or `~`)
- Unsupported file types
- Sync-locked paths
- Recently-synced paths

### 3. Clusterer (clusterer.py)

**Purpose:** HDBSCAN on high-dimensional embeddings + UMAP for visualization

**Key Design:** HDBSCAN runs on ORIGINAL embeddings (768 or 1536 dimensions) with cosine metric for accurate semantic clustering. UMAP-2D is used ONLY for visualization coordinates, never for clustering decisions.

**Algorithm:**

1. **Normalize dimensions** — Re-embed or pad/truncate to target dimension
2. **Cluster on high-dimensional embeddings:**
   - If N ≤ 25: Agglomerative (distance_threshold=0.45)
   - If N > 25: HDBSCAN (min_cluster_size=2, metric=euclidean on L2-normalized)
3. **Smart noise assignment:**
   - Compute cluster centroids
   - For each noise point: find closest centroid by cosine similarity
   - If similarity ≥ 0.40 → assign to cluster
   - Else → keep as noise → "Uncategorised" folder
4. **UMAP 2D projection** — For visualization only (n_neighbors=15, min_dist=0.1)
5. **Scale coordinates** — [-400, 400] for graph layout

**Important Thresholds:**

- `MIN_FILES_FOR_CLUSTERING = 3`
- `NOISE_SIMILARITY_THRESHOLD = 0.40`
- `SMALL_COLLECTION_THRESHOLD = 25`
- Agglomerative distance threshold: `0.45` (≈ cosine similarity 0.55)

**Fallback Chain:**

- HDBSCAN → Agglomerative → Simple 2D layout
- UMAP → PCA → Simple circle layout

### 4. Embedder (embedder.py)

**Purpose:** Generate embeddings and summaries using Ollama or OpenAI

**Provider Selection:**

- Uses `settings.selected_provider` (no cross-provider fallback)
- Ollama: `nomic-embed-text` (768-dim), `llama3.2` (LLM)
- OpenAI: `text-embedding-3-small` (1536-dim), `gpt-4o-mini` (LLM)

**Key Functions:**

- `get_embedding(text)` — Generate embedding using selected provider
- `get_embedding_matching_dim(text, target_dim)` — Generate and resize to target dimension
- `generate_summary(text)` — Generate 1-2 sentence summary
- `get_expected_embedding_dim()` — Expected dimension for active provider

**Text Truncation:**

- Max chars: 20,000
- Strategy: First 10k + last 10k with "..." separator

**Dimension Handling:**

- Tracks last embedding dimension per provider
- Pads or truncates to match target dimension
- Re-embeds outliers during clustering

**Fallback:**

- If provider fails → zero vector (not cross-provider fallback)
- If summary fails → first 200 chars of text

### 5. Sync (sync.py)

**Purpose:** Move files into semantic folders at OS level

**Key Pattern: Sync Lock**

- Set lock → move files → 2.5s delay → release lock
- Prevents watcher from re-triggering on system-initiated moves
- Recently-synced paths tracked with 5s TTL (belt-and-suspenders)

**Collision Handling:**

- If target exists: append `_1`, `_2`, etc. to filename
- Example: `file.txt` → `file_1.txt` → `file_2.txt`

**Cleanup:**

- Removes empty directories after moves
- Keeps cluster folders even if empty

**Move Logic:**

1. Create cluster folders
2. For each file:
   - Resolve best source path (current → original → fallback)
   - Skip if already in correct location
   - Handle name collisions
   - Register paths in recently-synced set
   - Move file with shutil
3. Cleanup empty directories
4. Wait 2.5s for FSEvents latency
5. Release sync lock

### 6. Database (db.py)

**Purpose:** SQLite persistence with aiosqlite

**Tables:**

**files:**

- `id` (INTEGER PRIMARY KEY)
- `filename` (TEXT)
- `original_path` (TEXT UNIQUE)
- `current_path` (TEXT)
- `content_hash` (TEXT)
- `embedding` (BLOB) — numpy array serialized with `np.tobytes()`
- `summary` (TEXT)
- `file_type` (TEXT)
- `size_bytes` (INTEGER)
- `word_count` (INTEGER)
- `page_count` (INTEGER)
- `cluster_id` (INTEGER)
- `umap_x` (REAL)
- `umap_y` (REAL)
- `created_at` (TEXT)
- `modified_at` (TEXT)

**clusters:**

- `id` (INTEGER PRIMARY KEY)
- `name` (TEXT)
- `description` (TEXT)
- `folder_path` (TEXT)
- `centroid` (BLOB) — numpy array
- `file_count` (INTEGER)
- `created_at` (TEXT)

**events:**

- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `file_id` (INTEGER)
- `event_type` (TEXT)
- `filename` (TEXT)
- `timestamp` (TEXT)

**settings:**

- `key` (TEXT PRIMARY KEY)
- `value` (TEXT) — JSON

**Key Operations:**

- `upsert_file(record)` — Insert or update file record
- `get_file_by_path(path)` — Lookup by current or original path
- `get_file_by_hash(hash)` — Lookup by content hash
- `update_file_cluster(id, cluster_id)` — Update cluster assignment
- `update_file_umap(id, x, y)` — Update visualization coordinates
- `update_file_current_path(id, path)` — Update path after move
- `clear_clusters()` — Delete all clusters (atomic replace during recluster)

### 7. Main (main.py)

**Purpose:** FastAPI server with REST API + WebSocket

**Lifecycle:**

1. Initialize database
2. Load saved settings
3. Health check selected provider
4. Run initial scan (BEFORE starting watcher)
5. Start file watcher
6. Serve requests

**WebSocket:**

- `ConnectionManager` — Manages active WebSocket connections
- `broadcast(data)` — Send event to all connected clients
- Events: `file_added`, `file_removed`, `reclustering_start`, `reclustering_end`, `scan_complete`

**ReclusterScheduler:**

- Debounces rapid recluster requests (2s)
- Cooldown period (5s) prevents spurious reclustering
- Single-task execution with async lock

**Key Endpoints:**

| Method | Path                          | Description                             |
| ------ | ----------------------------- | --------------------------------------- |
| GET    | `/api/status`                 | File count, cluster count, root folder  |
| GET    | `/api/files`                  | All tracked files                       |
| GET    | `/api/file/{id}`              | Single file details                     |
| GET    | `/api/clusters`               | All clusters with metadata              |
| GET    | `/api/graph`                  | Full visualization data (nodes + links) |
| GET    | `/api/events`                 | Recent event log                        |
| GET    | `/api/search?q=...`           | Semantic search via cosine similarity   |
| POST   | `/api/rescan`                 | Force full re-scan and recluster        |
| POST   | `/api/open/{id}`              | Open file with OS default app           |
| GET    | `/api/file/{id}/related`      | Find similar files                      |
| GET    | `/api/file/{id}/compare/{id}` | LLM-powered file comparison             |
| POST   | `/api/chat`                   | RAG chat with file context (streaming)  |
| GET    | `/api/settings`               | Get current settings                    |
| PUT    | `/api/settings`               | Save settings                           |
| POST   | `/api/settings/test`          | Test provider connection                |
| GET    | `/api/metrics`                | Performance metrics                     |
| WS     | `/ws`                         | Real-time event stream                  |

### 8. Frontend (App.tsx)

**Purpose:** Main React application with dual visualization modes

**State Management:**

- `graphData` — Full graph data (nodes, links, clusters)
- `viewMode` — "graph" or "spatial"
- `selectedNode` — Currently selected file/cluster
- `searchQuery` — Semantic search query
- `events` — Event log
- `liveEvents` — Real-time WebSocket events

**Key Features:**

- **Command palette search:** ⌘K to open semantic search overlay
- **Dual visualization:** Toggle between force graph and spatial map
- **Real-time updates:** WebSocket-driven live animations
- **Desktop notifications:** Tauri notifications for file events
- **Dark/light theme:** Persisted in localStorage
- **Settings modal:** Configure Ollama/OpenAI providers
- **Chat panel:** RAG chat with file context

**WebSocket Events:**

- `file_added` → refetch data after 1s
- `file_removed` → refetch data after 1s
- `reclustering_start` → show "Processing..." indicator
- `reclustering_end` → refetch data after 500ms
- `scan_complete` → refetch data after 500ms

**Search:**

- Debounced semantic search (400ms)
- Displays results with similarity scores
- Click result → select node in visualization

## Configuration

### Backend (.env)

```bash
# Root folder to monitor
ROOT_FOLDER=~/sefs_root

# Ollama settings
OLLAMA_HOST=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text:latest
OLLAMA_LLM_MODEL=llama3.2:latest

# OpenAI settings (optional)
OPENAI_API_KEY=sk-...
OPENAI_EMBED_MODEL=text-embedding-3-small
OPENAI_MODEL=gpt-4o-mini

# Server settings
HOST=0.0.0.0
PORT=8484
```

### Frontend (vite.config.ts)

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:8484',
    '/ws': {
      target: 'ws://localhost:8484',
      ws: true
    }
  }
}
```

## Development Workflow

### Adding a New Feature

1. **Backend:**
   - Add endpoint in `main.py`
   - Implement logic in appropriate module (pipeline, clusterer, etc.)
   - Update database schema if needed (db.py)
   - Add tests in `backend/tests/`

2. **Frontend:**
   - Add API call in `api.ts`
   - Update TypeScript interfaces in `types.ts`
   - Implement UI component in `components/` or `views/`
   - Update `App.tsx` if needed

3. **Testing:**
   - Backend: `cd backend && pytest`
   - Frontend: Manual testing in browser
   - Desktop: `npm run tauri:dev`

### Debugging Tips

**Backend:**

- Check logs: `python -m uvicorn app.main:app --log-level debug`
- SQLite browser: `sqlite3 backend/sefs.db`
- Test embeddings: `python -c "from app.embedder import get_embedding; import asyncio; print(asyncio.run(get_embedding('test')))"`

**Frontend:**

- React DevTools: Inspect component state
- Network tab: Check API calls and WebSocket messages
- Console: Check for errors and warnings

**Clustering:**

- Check metrics: `GET /api/metrics`
- Inspect cluster centroids: `SELECT id, name, file_count FROM clusters`
- Verify embeddings: `SELECT id, filename, length(embedding) FROM files`

## Common Issues & Solutions

### Issue: Files not clustering correctly

**Possible causes:**

1. Embedding dimension mismatch (Ollama 768 vs OpenAI 1536)
2. Zero embeddings (provider unavailable)
3. Too few files (< 3)
4. All files too similar (HDBSCAN finds only noise)

**Solutions:**

1. Check provider health: `POST /api/settings/test`
2. Verify embeddings: `SELECT id, filename, length(embedding) FROM files WHERE embedding IS NOT NULL`
3. Check metrics: `GET /api/metrics`
4. Force recluster: `POST /api/rescan`

### Issue: Watcher triggering on system moves

**Possible causes:**

1. Sync lock not set properly
2. FSEvents latency (macOS)
3. Recently-synced paths not tracked

**Solutions:**

1. Check sync lock in logs: `"Sync lock: True"`
2. Increase delay in `sync.py`: `await asyncio.sleep(3.0)`
3. Increase TTL in `sync.py`: `_SYNCED_PATH_TTL = 7.0`

### Issue: Duplicate file records in database

**Possible causes:**

1. Manual file moves in Finder
2. Watcher events during sync
3. Content hash collision (rare)

**Solutions:**

1. Run record repair: Happens automatically during `run_clustering()`
2. Check for duplicates: `SELECT content_hash, COUNT(*) FROM files GROUP BY content_hash HAVING COUNT(*) > 1`
3. Manual cleanup: `DELETE FROM files WHERE id NOT IN (SELECT MAX(id) FROM files GROUP BY content_hash)`

### Issue: Frontend not receiving WebSocket events

**Possible causes:**

1. WebSocket connection failed
2. Backend not broadcasting
3. CORS issues

**Solutions:**

1. Check connection status in UI (top-right indicator)
2. Check browser console for WebSocket errors
3. Verify proxy config in `vite.config.ts`
4. Test WebSocket: `wscat -c ws://localhost:8484/ws`

## Performance Optimization

### Backend

**Embedding generation:**

- Batch embeddings when possible (not currently implemented)
- Cache embeddings in DB (already implemented)
- Use faster models (e.g., `nomic-embed-text` vs `text-embedding-3-large`)

**Clustering:**

- Incremental assignment for new files (already implemented)
- Debounced reclustering (already implemented)
- Skip UMAP for large collections (use PCA fallback)

**Database:**

- Index on `content_hash` for deduplication
- Index on `cluster_id` for cluster queries
- Vacuum database periodically: `VACUUM`

### Frontend

**Rendering:**

- Limit graph nodes (already limited by backend)
- Use `useMemo` for expensive computations (already implemented)
- Debounce search queries (already implemented)

**WebSocket:**

- Throttle event processing (not currently implemented)
- Batch UI updates (not currently implemented)

## Testing

### Backend Tests

```bash
cd backend
pytest -v
```

**Test coverage:**

- `test_extractor.py` — Content extraction
- `test_embedder.py` — Embedding generation
- `test_clusterer.py` — Clustering algorithm
- `test_db.py` — Database operations
- `test_pipeline.py` — End-to-end pipeline

### Manual Testing

**Backend:**

1. Start backend: `python -m uvicorn app.main:app --reload`
2. Drop files into root folder
3. Check logs for processing events
4. Verify clusters created: `ls ~/sefs_root`
5. Check database: `sqlite3 backend/sefs.db "SELECT * FROM clusters"`

**Frontend:**

1. Start frontend: `npm run dev`
2. Open browser: `http://localhost:5173`
3. Verify graph renders
4. Test search: ⌘K → type query
5. Test chat: Click chat icon → ask question
6. Test settings: Click settings icon → change provider

**Desktop:**

1. Start Tauri: `npm run tauri:dev`
2. Verify backend auto-spawns
3. Test desktop notifications
4. Verify window management

## Deployment

### Backend

**Production server:**

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8484 --workers 1
```

**Systemd service:**

```ini
[Unit]
Description=SEFS Backend
After=network.target

[Service]
Type=simple
User=sefs
WorkingDirectory=/opt/sefs/backend
ExecStart=/opt/sefs/backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8484
Restart=always

[Install]
WantedBy=multi-user.target
```

### Frontend

**Build:**

```bash
cd frontend
npm run build
```

**Serve:**

```bash
npx serve -s dist -p 5173
```

### Desktop

**Build:**

```bash
cd frontend
npm run tauri:build
```

**Output:**

- macOS: `frontend/src-tauri/target/release/bundle/macos/SEFS.app`
- Windows: `frontend/src-tauri/target/release/bundle/msi/SEFS.msi`
- Linux: `frontend/src-tauri/target/release/bundle/deb/sefs.deb`

## Security Considerations

1. **API Keys:**
   - Never commit `.env` files
   - Use environment variables in production
   - Rotate keys regularly

2. **File Access:**
   - Validate file paths to prevent directory traversal
   - Sanitize filenames before moving
   - Check file permissions before reading

3. **WebSocket:**
   - Implement authentication for production
   - Rate limit connections
   - Validate incoming messages

4. **Database:**
   - Use parameterized queries (already implemented)
   - Regular backups
   - Encrypt sensitive data

## Future Enhancements

### Planned Features

1. **Multi-user support:**
   - User authentication
   - Per-user root folders
   - Shared clusters

2. **Advanced clustering:**
   - Hierarchical clusters (sub-folders)
   - Custom cluster rules
   - Manual cluster assignment

3. **Enhanced search:**
   - Full-text search
   - Filter by file type, date, size
   - Saved searches

4. **Collaboration:**
   - Share clusters with others
   - Comments on files
   - Activity feed

5. **Mobile app:**
   - iOS/Android clients
   - Mobile-optimized UI
   - Offline support

### Performance Improvements

1. **Batch processing:**
   - Batch embedding generation
   - Batch database operations
   - Parallel file processing

2. **Caching:**
   - Redis for embeddings
   - CDN for frontend assets
   - Browser caching

3. **Optimization:**
   - Incremental UMAP updates
   - Lazy loading for large collections
   - WebGL rendering for graphs

## Contributing

### Code Style

**Python:**

- Follow PEP 8
- Use type hints
- Document functions with docstrings
- Max line length: 88 (Black formatter)

**TypeScript:**

- Follow Airbnb style guide
- Use functional components
- Prefer `const` over `let`
- Use TypeScript strict mode

### Commit Messages

```
feat: Add semantic search to chat panel
fix: Prevent duplicate file records on manual moves
docs: Update KIRO.md with clustering algorithm
refactor: Extract sync lock logic to separate module
test: Add tests for incremental clustering
```

### Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes and commit: `git commit -m "feat: Add my feature"`
4. Push to branch: `git push origin feat/my-feature`
5. Open pull request with description

## Support

### Documentation

- **README.md** — User-facing documentation
- **CLAUDE.md** — Claude Code guidance
- **ARCHITECTURE.md** — Architecture diagrams
- **KIRO.md** — This file (comprehensive guide)

### Community

- **GitHub Issues** — Bug reports and feature requests
- **Discussions** — Questions and ideas
- **Discord** — Real-time chat (coming soon)

### Contact

- **Email:** [your-email]
- **Twitter:** [your-twitter]
- **Website:** [your-website]

---

**Last Updated:** February 12, 2026
**Version:** 0.1.0
**License:** MIT
