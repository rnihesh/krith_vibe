# 🧠 SEFS — Semantic Entropy File System

A **self-organising file manager** that replaces static folders with a dynamic semantic layer. Files are automatically analysed, clustered by content similarity, and projected into a live 2D interface — all synchronised with your OS file structure in real time.

## Architecture

```
┌─────────────────────────────────────────────┐
│        React Frontend (Vite + TypeScript)    │
│   ┌─── Force-Directed Graph (react-force-graph)
│   ├─── UMAP Spatial Map (D3.js)             │
│   ├─── Sidebar (metadata inspector)         │
│   └─── WebSocket (live event feed)          │
└───────────────┬─────────────────────────────┘
                │ WebSocket + REST API
┌───────────────┴─────────────────────────────┐
│          Python Backend (FastAPI)            │
│   ├── File Watcher (watchdog / FSEvents)    │
│   ├── Content Extractor (PyMuPDF, docx, md) │
│   ├── Embedding Engine (Ollama → OpenAI)    │
│   ├── Clustering (HDBSCAN + UMAP)           │
│   ├── Folder Namer (LLM-generated)          │
│   ├── OS Synchronizer (shutil, debounced)   │
│   └── Metadata Store (SQLite)               │
└───────────────┬─────────────────────────────┘
          ┌─────┴─────┐
          │ Root Folder│  ← Single monitored directory
          └───────────┘
```

## Features

- **Auto-Detection**: Monitors a root folder for PDF, TXT, MD, DOCX, CSV files
- **Semantic Clustering**: HDBSCAN + UMAP automatically groups related documents
- **OS-Level Sync**: Creates real folders, moves files — bidirectional with Finder
- **LLM-Powered Names**: Cluster folders get descriptive names via Ollama/OpenAI
- **Dual Visualization**: Toggle between force-directed graph and UMAP spatial map
- **Real-Time Updates**: WebSocket-driven live animations for file events
- **Provider Control**: Switch between Ollama and OpenAI from in-app settings
- **Desktop Alerts**: Tauri desktop notifications for file/cluster activity
- **AI Chat + RAG**: Ask questions across your files with source citations
- **Hover Metadata**: File type, size, word count, summary on hover
- **Dark Theme**: Glassmorphism panels, glowing nodes, particle effects

## Quick Start

```bash
# 1. Clone and enter project
cd krith_vibe

# 2. Run the start script (installs everything + launches)
chmod +x start.sh
./start.sh

# 3. Drop files into ~/sefs_root and watch the magic!
```

## Manual Setup

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
python -m uvicorn app.main:app --host 0.0.0.0 --port 8484
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # Web mode at http://localhost:5173
npm run tauri:dev    # Desktop mode (Tauri)
```

## Configuration

Edit `backend/.env`:

| Variable             | Default                   | Description       |
| -------------------- | ------------------------- | ----------------- |
| `ROOT_FOLDER`        | `~/sefs_root`      | Folder to monitor |
| `OLLAMA_HOST`        | `http://localhost:11434`  | Ollama server     |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text:latest` | Embedding model   |
| `OLLAMA_LLM_MODEL`   | `llama3.2:latest`         | LLM for naming    |
| `OPENAI_API_KEY`     | —                         | Fallback API key  |

## How It Works

1. **Watch**: `watchdog` monitors `ROOT_FOLDER` for file create/modify/delete/move
2. **Extract**: Content is pulled from PDFs (PyMuPDF), DOCX, Markdown, CSV, TXT
3. **Embed**: Text → vector embedding via Ollama (`nomic-embed-text`) or OpenAI
4. **Cluster**: UMAP reduces dimensions → HDBSCAN finds natural groupings
5. **Name**: Each cluster gets an LLM-generated folder name
6. **Sync**: Files physically move into semantic folders at the OS level
7. **Visualize**: Frontend renders live node graph with animated updates

## Tech Stack

| Layer        | Technology                                  |
| ------------ | ------------------------------------------- |
| Backend      | Python 3.10+, FastAPI, uvicorn              |
| Extraction   | PyMuPDF, python-docx, markdown, pandas      |
| Embeddings   | Ollama (nomic-embed-text) → OpenAI fallback |
| Clustering   | HDBSCAN, UMAP, scikit-learn                 |
| Database     | SQLite (aiosqlite)                          |
| Frontend     | React 18, TypeScript, Vite                  |
| Graph View   | react-force-graph-2d                        |
| Spatial View | D3.js (Voronoi + UMAP scatter)              |
| Animations   | Framer Motion                               |
| Desktop      | Tauri v2                                    |

## API Endpoints

| Method | Path            | Description                     |
| ------ | --------------- | ------------------------------- |
| GET    | `/api/status`   | System status                   |
| GET    | `/api/files`    | All tracked files               |
| GET    | `/api/file/:id` | Single file detail              |
| GET    | `/api/clusters` | All clusters                    |
| GET    | `/api/graph`    | Full graph data (nodes + links) |
| GET    | `/api/events`   | Recent event log                |
| POST   | `/api/rescan`   | Force full re-scan              |
| WS     | `/ws`           | Real-time event stream          |

---

Built for **AI Week Hackathon** — Problem Statement 3: Semantic Entropy File System
