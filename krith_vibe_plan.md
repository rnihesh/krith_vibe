# SEFS Hackathon Sprint Plan

## Context

SEFS is a semantic file system for the AI Week hackathon (PS-3). The core functionality works — file watching, embedding, HDBSCAN clustering, OS-level sync, real-time graph/spatial visualization. But it has race conditions, silent failures, no model selection UI, and lacks "wow factor" features. Judges evaluate edge case handling, performance, latency, robustness, and backend engineering. This overnight sprint makes the app flawless and adds differentiating features.

---

## Phase 1: Fix All Existing Issues (make it flawless)

### 1.1 Pipeline Race Conditions
**Files:** `backend/app/main.py`, `backend/app/pipeline.py`

Replace the bare `_recluster_scheduled` / `_recluster_lock` globals in `main.py` with a proper `ReclusterScheduler` class:
- Debounces rapid requests (2s window)
- Ensures only one clustering runs at a time via asyncio.Lock
- Re-checks pending flag after each run to catch events that arrived during clustering
- Both `on_file_change` and `on_file_delete` use `scheduler.request()` instead of raw asyncio.sleep

In `pipeline.py` `run_clustering()`: wrap all file access in try/except FileNotFoundError (files can be deleted between DB query and disk read at ~line 146 and ~line 212). Fall back to using `f.summary` when file is gone.

### 1.2 Embedder Global State
**File:** `backend/app/embedder.py`

`EMBED_DIM` is mutated globally by concurrent async calls to `_embed_ollama` (768-dim) and `_embed_openai` (1536-dim). Fix: replace with `_last_embed_dim` protected by `asyncio.Lock`. Update dim after each successful call; read dim under lock for zero-vector fallback.

### 1.3 API Robustness
**File:** `backend/app/main.py`

- Clamp `limit` params: `get_events` → max 200, `semantic_search` → max 50
- Add `asyncio.wait_for(timeout=15.0)` around embedding call in search endpoint
- WebSocket loop: wrap inner handler in broad `except Exception` (not just `WebSocketDisconnect`), move `manager.disconnect(ws)` to `finally` block
- Add startup health check in lifespan: verify at least one of Ollama/OpenAI is reachable, log warning if not

### 1.4 Watcher Debounce Fix
**File:** `backend/app/watcher.py`

Replace per-event coroutine spawning with a single-task debounce: collect pending paths in a dict, cancel+reset a single timer on each event, flush all pending paths in one batch when timer fires. Prevents 100 coroutines from spawning during rapid file additions.

### 1.5 Frontend Error Handling
**Files:** New `frontend/src/components/Toast.tsx`, modify `frontend/src/App.tsx`

Create a toast notification component (bottom-right, above EventFeed). Uses framer-motion, auto-dismiss 5s, themed with existing CSS variables. Wire into `fetchData` catch blocks and API errors so users see feedback instead of silent `console.warn`.

### 1.6 Loading & Empty States
**Files:** `frontend/src/App.tsx`, `frontend/src/views/GraphView.tsx`, `frontend/src/views/SpatialView.tsx`

- Add `isLoading` state, show spinner during initial graph fetch
- Replace generic "No files to display" with onboarding empty state: show ROOT_FOLDER path (fetched from `/api/status`), supported file types, instructions

### 1.7 WebSocket Exponential Backoff
**File:** `frontend/src/hooks/useWebSocket.ts`

Replace fixed 2s reconnect with exponential backoff: 1s base, 2x growth, 30s max. Reset retry count on successful connect.

### 1.8 Clean Up Electron Artifacts
**File:** `frontend/package.json`

Remove `electron`, `electron-builder`, `concurrently`, `wait-on` from devDependencies. Remove `electron:dev`/`electron:build` scripts, `"main"` field, and `"build"` block.

### 1.9 Tauri Backend Spawning
**Files:** `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/Cargo.toml`

- Add fallback: try `uv run uvicorn ...` first, then `python3 -m uvicorn ...` if uv not found
- Add health check polling thread: poll `localhost:8484/api/status` for up to 30s before considering backend ready
- Add `reqwest = { version = "0.12", features = ["blocking"] }` to Cargo.toml

---

## Phase 2: Settings Page (Model Selection)

### 2.1 Backend
**Files:** New `backend/app/settings.py`, modify `backend/app/db.py`, `backend/app/main.py`, `backend/app/config.py`

- Add `settings` table to DB schema (`key TEXT PRIMARY KEY, value TEXT`)
- New `settings.py` module: `get_settings()`, `save_settings()`, `test_connection()`
- Supports: provider (ollama/openai), ollama_host, ollama_embed_model, ollama_llm_model, openai_api_key, openai_model
- Three new endpoints: `GET /api/settings`, `PUT /api/settings`, `POST /api/settings/test`
- `config.py`: add `update_from_dict()` method to update runtime settings
- `save_settings()` updates both DB and live config via `settings.update_from_dict()`

### 2.2 Frontend
**Files:** New `frontend/src/components/SettingsModal.tsx`, modify `frontend/src/api.ts`, `frontend/src/App.tsx`

Settings modal (gear icon in header, between theme toggle and live indicator):
- Same overlay pattern as search (backdrop blur, rounded-2xl card, bg-bg-card)
- Radio toggle: Ollama / OpenAI
- Conditional fields: Ollama shows host+embed model+LLM model; OpenAI shows API key (masked) + model
- "Test Connection" button (bg-bg-dark) and "Save" button (bg-accent)
- Success/failure feedback inline

---

## Phase 3: AI Chat with Files (RAG)

### 3.1 Backend
**Files:** New `backend/app/chat.py`, modify `backend/app/main.py`

`POST /api/chat` — SSE streaming endpoint:
1. Semantic search for top 5 relevant files (reuse existing cosine similarity logic)
2. Build context from file summaries + content snippets (first 1500 chars)
3. Stream LLM response via Ollama (with OpenAI fallback)
4. Yields SSE events: `{"type":"sources","files":[...]}` → `{"type":"token","content":"..."}` → `{"type":"done"}`

Prompt template instructs LLM to answer based on file contents, cite filenames, and be honest when files don't contain relevant info.

### 3.2 Frontend
**Files:** New `frontend/src/components/ChatPanel.tsx`, modify `frontend/src/api.ts`, `frontend/src/App.tsx`

Chat drawer (400px, slides from right, toggle via MessageSquare icon in header):
- Message list: user bubbles (right-aligned, bg-accent-light, rounded-2xl) and AI bubbles (left-aligned, bg-bg-dark, rounded-2xl)
- Source files shown as small pills under AI messages (click to select file in graph)
- Input at bottom with send button (bg-accent)
- Streaming: read SSE via fetch ReadableStream, append tokens to current AI message
- Typing indicator (three-dot CSS animation)
- Theme-matched, no generic chatbot look

---

## Phase 4: Relationship Insights

### 4.1 Backend
**File:** `backend/app/main.py`

Two new endpoints:
- `GET /api/file/{id}/related?limit=5` — returns top N similar files with cosine similarity scores
- `GET /api/file/{id1}/compare/{id2}` — uses LLM to explain relationship between two files (reuses `embedder.generate_summary`)

### 4.2 Frontend
**Files:** `frontend/src/components/Sidebar.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts`

In Sidebar, when a file is selected, fetch and show "Related Files" section:
- List of related files with cluster color dot, filename, similarity percentage badge
- Click a related file to navigate to it (updates selectedNode)
- Styled consistently: bg-bg-dark rounded-lg items, accent-light similarity badges

---

## Phase 5: Smart Notifications

### 5.1 Backend
**File:** `backend/app/pipeline.py`

Enrich WebSocket broadcast events:
- `reclustering_end`: include cluster summaries (name + file count), file movements (which files moved where), total moves count
- `file_added`/`file_modified`: include file_type, word_count, summary snippet
- Cap movement details at 10 per event

### 5.2 Frontend
**Files:** `frontend/src/components/EventFeed.tsx`, `frontend/src/types.ts`

Upgrade notification messages:
- "Added report.pdf (2,340 words)" instead of "Added: file"
- "Organized into 4 groups (3 files moved)" instead of "Reclustered into 4 groups"
- Extend WSEvent interface with new optional fields

---

## Phase 6: Performance Dashboard

### 6.1 Backend
**Files:** New `backend/app/metrics.py`, modify `backend/app/pipeline.py`, `backend/app/main.py`

- `metrics.py`: `PipelineMetrics` dataclass with deques (maxlen=100) for extraction/embedding/clustering times. `Timer` context manager. `get_summary()` returns averages.
- Wrap pipeline stages with `Timer` in `process_file()` and `run_clustering()`
- New endpoint: `GET /api/metrics`

### 6.2 Frontend
**Files:** New `frontend/src/components/MetricsPanel.tsx`, modify `frontend/src/api.ts`, `frontend/src/App.tsx`

Collapsible panel (bottom-left, above cluster legend). Collapsed: small "Performance" pill. Expanded: compact card showing avg extraction ms, avg embedding ms, last clustering ms, total files processed. Styled with bg-bg-card, matching theme. Polls `/api/metrics` every 10s when expanded.

---

## Files Summary

### New Files (7)
| File | Purpose |
|------|---------|
| `backend/app/settings.py` | Runtime settings management + test connection |
| `backend/app/chat.py` | RAG chat with SSE streaming |
| `backend/app/metrics.py` | Pipeline performance instrumentation |
| `frontend/src/components/Toast.tsx` | Error/success toast notifications |
| `frontend/src/components/SettingsModal.tsx` | Model selection settings modal |
| `frontend/src/components/ChatPanel.tsx` | AI chat drawer |
| `frontend/src/components/MetricsPanel.tsx` | Performance stats panel |

### Modified Files (18)
| File | Key Changes |
|------|-------------|
| `backend/app/main.py` | ReclusterScheduler, WS error handling, 6 new endpoints, limit validation, startup health check |
| `backend/app/pipeline.py` | FileNotFoundError guards, metrics timers, enriched broadcast events |
| `backend/app/embedder.py` | Fix global EMBED_DIM race condition with asyncio.Lock |
| `backend/app/watcher.py` | Single-task debounce pattern replacing per-event coroutines |
| `backend/app/db.py` | Add settings table + get/set functions |
| `backend/app/config.py` | Add update_from_dict() for runtime config changes |
| `frontend/src/App.tsx` | Toast state, loading state, settings/chat/metrics buttons |
| `frontend/src/api.ts` | New API functions: settings, chat, metrics, related files |
| `frontend/src/types.ts` | Extend WSEvent, add new interfaces |
| `frontend/src/hooks/useWebSocket.ts` | Exponential backoff reconnection |
| `frontend/src/views/GraphView.tsx` | Loading + empty state with root folder path |
| `frontend/src/views/SpatialView.tsx` | Loading state |
| `frontend/src/components/Sidebar.tsx` | Related Files section |
| `frontend/src/components/EventFeed.tsx` | Rich notification messages |
| `frontend/src/index.css` | Typing indicator keyframes |
| `frontend/package.json` | Remove electron deps |
| `frontend/src-tauri/src/lib.rs` | Fallback backend spawn + health check |
| `frontend/src-tauri/Cargo.toml` | Add reqwest dependency |

---

## Verification

After each phase, test:
1. **Stability**: Add 10 files rapidly → only 1 recluster. Delete file mid-cluster → no crash. Kill backend → frontend shows error toast. Reconnect → backoff works.
2. **Settings**: Switch Ollama↔OpenAI → embeddings use correct provider. Test connection → shows success/failure. Restart → settings persist.
3. **Chat**: Ask "what are my files about?" → relevant files cited. Ask unrelated question → honest "not found". Stream renders smoothly.
4. **Related**: Select file → 5 related files with scores. Click related file → navigates.
5. **Notifications**: Add file → shows type + word count. Recluster → shows movement details.
6. **Metrics**: Process files → panel shows timing. Values are reasonable (ms range).

Full end-to-end: `./start.sh` → drop 5 diverse files → watch auto-clustering → search semantically → chat about files → check related files → verify settings persist across restart.
