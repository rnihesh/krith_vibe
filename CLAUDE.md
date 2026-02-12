# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SEFS (Semantic Entropy File System)** — A self-organizing file manager that replaces static folder hierarchies with dynamic semantic clustering. Files dropped into a monitored root folder are automatically analyzed, embedded, clustered by content similarity, and physically moved into semantically-named OS folders. A React frontend provides real-time 2D visualization (force-directed graph + Voronoi spatial map). Built for AI Week Hackathon (Problem Statement 3).

## Build & Run

### Full Stack (recommended)
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
npm run dev    # Vite dev server on :5173, proxies /api and /ws to :8484
```

### Desktop (Tauri v2)
```bash
cd frontend
npm run tauri:dev      # Dev mode: Vite + Tauri window, auto-spawns backend via `uv run uvicorn`
npm run tauri:build    # Production .app/.dmg bundle
```
Tauri's Rust shell (`frontend/src-tauri/src/lib.rs`) auto-spawns the Python backend on startup and kills it on window close.

### Tests
```bash
cd backend && pytest
```

## Architecture

**Monorepo:** Python FastAPI backend + React/TypeScript frontend + Tauri v2 desktop shell.

### Backend (`backend/app/`)

Pipeline-based architecture: **extract → embed → cluster → name → sync → notify**

| Module | Role |
|--------|------|
| `main.py` | FastAPI server, REST API, WebSocket broadcasting via `ConnectionManager` |
| `config.py` | Pydantic Settings from `.env` (Ollama/OpenAI keys, root folder, port) |
| `pipeline.py` | Orchestrates full processing flow; debounces reclustering (2s) |
| `extractor.py` | Content extraction: PDF (PyMuPDF), DOCX, MD, CSV, TXT, RST |
| `embedder.py` | Embedding via Ollama (nomic-embed-text) with OpenAI fallback; also generates LLM summaries |
| `clusterer.py` | HDBSCAN on high-dim embeddings (semantic), UMAP for 2D viz only; agglomerative fallback for <25 files |
| `namer.py` | LLM-powered folder naming with keyword extraction fallback |
| `watcher.py` | `watchdog` file system monitor with 1.5s debounce |
| `sync.py` | Moves files to semantic folders on disk; sync lock prevents watcher re-triggering |
| `db.py` | aiosqlite persistence: `files`, `clusters`, `events` tables; embeddings stored as numpy BLOB |

**Key patterns:**
- Graceful degradation: Ollama → OpenAI → zero vector; HDBSCAN → Agglomerative; LLM naming → keyword extraction
- Sync lock pattern in `sync.py` prevents watcher from re-triggering on system-initiated moves
- All I/O is async (aiosqlite, httpx, ollama client)
- Embeddings are numpy float32 arrays serialized to SQLite BLOBs via `np.tobytes()`

### Frontend (`frontend/src/`)

| File | Role |
|------|------|
| `App.tsx` | Main layout, state management, search overlay (⌘K), view toggle |
| `api.ts` | Fetch wrapper for backend REST endpoints (resolves backend at `:8484`) |
| `types.ts` | TypeScript interfaces (`SEFSFile`, `SEFSCluster`, `GraphData`, `WSEvent`) + utility fns |
| `views/GraphView.tsx` | `react-force-graph-2d` force-directed visualization |
| `views/SpatialView.tsx` | D3.js Voronoi/UMAP scatter plot |
| `components/Sidebar.tsx` | File/cluster metadata inspector panel |
| `components/EventFeed.tsx` | Real-time event log from WebSocket |
| `hooks/useWebSocket.ts` | WebSocket connection with auto-reconnect |
| `hooks/useTheme.ts` | Dark/light theme toggle persisted in localStorage |

### Tauri Desktop Shell (`frontend/src-tauri/`)

- **Tauri v2** with plugins: `tauri-plugin-shell`, `tauri-plugin-process`, `tauri-plugin-log`
- `lib.rs` spawns the backend as a child process (`uv run uvicorn ...`) on `setup()`
- Kills backend process on window `Destroyed` event
- Dev mode resolves backend path relative to `current_dir()/../backend`
- Config: `tauri.conf.json` — window 1280x820, min 900x600, CSP disabled for local dev

**Key frontend patterns:**
- `useMemo` for stable graph data, `useCallback` for handlers
- CSS variables + Tailwind for dynamic dark/light theming (`.dark` class on root)
- Vite proxy forwards `/api` and `/ws` to backend in dev

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | File count, cluster count |
| GET | `/api/files` | All tracked files |
| GET | `/api/file/{id}` | Single file details |
| GET | `/api/clusters` | All clusters with metadata |
| GET | `/api/graph` | Full visualization data (nodes + links) |
| GET | `/api/events` | Recent event log |
| GET | `/api/search?q=...&limit=` | Semantic search via cosine similarity |
| POST | `/api/rescan` | Force full re-scan and recluster |
| POST | `/api/open/{id}` | Open file with OS default app |
| WS | `/ws` | Real-time event stream |

### Data Flow

```
File dropped in ROOT_FOLDER
  → watchdog detects (1.5s debounce)
  → pipeline.process_file(): extract → embed → summarize → db.upsert_file()
  → pipeline.run_clustering() (2s debounce):
      HDBSCAN/Agglomerative → UMAP 2D → LLM naming → sync to OS folders
  → WebSocket broadcast → frontend refetch → visualization update
```

## Configuration

Backend config via `backend/.env`:
- `OLLAMA_HOST` — Local Ollama server (default: `http://localhost:11434`)
- `OLLAMA_EMBED_MODEL` — Embedding model (default: `nomic-embed-text`, 768-dim)
- `OLLAMA_LLM_MODEL` — LLM for naming/summaries (default: `llama3.2`)
- `OPENAI_API_KEY` — Fallback when Ollama unavailable
- `ROOT_FOLDER` — Monitored directory (default: `~/sefs_root`)
- `HOST`/`PORT` — Server binding (default: `0.0.0.0:8484`)

## Important Thresholds (clusterer.py)

- `MIN_FILES_FOR_CLUSTERING = 3`
- `NOISE_SIMILARITY_THRESHOLD = 0.40` (cosine sim for noise reassignment)
- `SMALL_COLLECTION_THRESHOLD = 25` (below this, use agglomerative)
- Agglomerative distance threshold: `0.52` (~cosine sim 0.48)

## Supported File Types

PDF, TXT, MD, DOCX, CSV, RST (defined in `extractor.py`)
