/* ─── API client for SEFS backend ─── */
import { GraphData, StatusInfo, EventLog } from "./types";

const API_BASE = `http://${window.location.hostname}:8484`;

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
