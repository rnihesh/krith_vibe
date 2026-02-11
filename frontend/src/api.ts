/* ─── API client for SEFS backend ─── */
import { GraphData, StatusInfo, EventLog } from "../types";

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
  return fetchJSON("/api/graph");
}

export async function getEvents(limit = 50): Promise<EventLog[]> {
  return fetchJSON(`/api/events?limit=${limit}`);
}

export async function rescan(): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/rescan`, { method: "POST" });
  return res.json();
}
