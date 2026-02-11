/* ─── API client for SEFS backend ─── */
import { GraphData, StatusInfo, EventLog } from "./types";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime(): boolean {
  return Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

function getBackendHost(): string {
  const host = window.location.hostname;
  if (
    isTauriRuntime() ||
    !host ||
    host === "tauri.localhost" ||
    host.endsWith(".localhost")
  ) {
    return "127.0.0.1";
  }
  return host;
}

export const API_BASE = `http://${getBackendHost()}:8484`;
export const WS_BASE = `ws://${getBackendHost()}:8484`;

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function getStatus(): Promise<StatusInfo> {
  return fetchJSON("/api/status");
}

export async function getGraphData(): Promise<GraphData> {
  const raw = await fetchJSON<any>("/api/graph");
  const nodes = raw.nodes || [];
  const files = nodes
    .filter((n: any) => n.type === "file")
    .map((n: any) => ({ ...n, filename: n.label || n.filename || "" }));
  return {
    nodes,
    links: raw.links || [],
    clusters: raw.clusters || [],
    files,
  };
}

export async function getEvents(limit = 50): Promise<EventLog[]> {
  return fetchJSON(`/api/events?limit=${limit}`);
}

export async function rescan(): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/rescan`, { method: "POST" });
  return res.json();
}

export async function openFile(fileId: number): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/open/${fileId}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to open file: ${res.statusText}`);
  return res.json();
}

export interface SearchResult {
  file_id: number;
  filename: string;
  summary: string;
  cluster_id: number;
  current_path: string;
  file_type: string;
  score: number;
}

export async function semanticSearch(
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  return fetchJSON(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

// ─── Settings API ─────────────────────────────────────────────

export type SettingsResponse = Record<string, string | boolean>;

export async function getSettings(): Promise<SettingsResponse> {
  return fetchJSON("/api/settings");
}

export async function saveSettings(
  data: Record<string, string>,
): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Save settings failed: ${res.statusText}`);
  return res.json();
}

export async function testConnection(
  data: Record<string, string>,
): Promise<{ success: boolean; message: string; models?: string[] }> {
  const res = await fetch(`${API_BASE}/api/settings/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Test connection failed: ${res.statusText}`);
  return res.json();
}

// ─── Chat API (SSE) ──────────────────────────────────────────

export interface ChatSource {
  file_id: number;
  filename: string;
  summary: string;
  score: number;
}

export async function sendChatMessage(
  message: string,
  onSources: (files: ChatSource[]) => void,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      onError(`Chat failed: ${res.statusText}`);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      onError("No response stream");
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let gotDone = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === "sources") onSources(evt.files || []);
          else if (evt.type === "token") onToken(evt.content || "");
          else if (evt.type === "done") {
            gotDone = true;
            onDone();
          } else if (evt.type === "error") {
            onError(evt.message || "Chat error");
            return;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
    // If stream ended without explicit done event, still signal done
    if (!gotDone) onDone();
  } catch (e: any) {
    onError(e?.message || "Chat request failed");
  }
}

// ─── Related Files API ───────────────────────────────────────

export interface RelatedFile {
  file_id: number;
  filename: string;
  cluster_id: number;
  similarity: number;
  summary: string;
}

export async function getRelatedFiles(
  fileId: number,
  limit = 5,
): Promise<RelatedFile[]> {
  return fetchJSON(`/api/file/${fileId}/related?limit=${limit}`);
}

export interface CompareResult {
  file_1: { id: number; filename: string };
  file_2: { id: number; filename: string };
  provider: "ollama" | "openai";
  analysis: string;
}

export async function compareFiles(
  fileId1: number,
  fileId2: number,
): Promise<CompareResult> {
  return fetchJSON(`/api/file/${fileId1}/compare/${fileId2}`);
}

// ─── Metrics API ─────────────────────────────────────────────

export interface MetricsSummary {
  avg_extraction_ms: number;
  avg_embedding_ms: number;
  last_clustering_ms: number;
  total_files_processed: number;
  extraction_count: number;
  embedding_count: number;
  clustering_count: number;
}

export async function getMetrics(): Promise<MetricsSummary> {
  return fetchJSON("/api/metrics");
}
