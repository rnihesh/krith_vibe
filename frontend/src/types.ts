/* ─── Type definitions for SEFS ─── */

export interface SEFSFile {
  id: string;
  file_id: number;
  label: string;
  cluster_id: number;
  x: number;
  y: number;
  file_type: string;
  size_bytes: number;
  word_count: number;
  page_count: number;
  summary: string;
  current_path: string;
  type: "file";
}

export interface SEFSCluster {
  id: string;
  cluster_id: number;
  label: string;
  file_count: number;
  description: string;
  type: "cluster";
  x: number;
  y: number;
}

export type GraphNode = SEFSFile | SEFSCluster;

export interface GraphLink {
  source: string;
  target: string;
  value: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  clusters: ClusterInfo[];
}

export interface ClusterInfo {
  id: number;
  name: string;
  description: string;
  folder_path: string;
  file_count: number;
  created_at: string;
}

export interface WSEvent {
  type: string;
  file_id?: number;
  filename?: string;
  cluster_count?: number;
  root?: string;
  file_count?: number;
  detail?: string;
}

export interface EventLog {
  id: number;
  file_id: number;
  event_type: string;
  detail: string;
  timestamp: string;
}

export interface StatusInfo {
  root_folder: string;
  file_count: number;
  cluster_count: number;
  status: string;
}

export type ViewMode = "graph" | "spatial";

// Cluster color palette
export const CLUSTER_COLORS = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#ec4899", // pink
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
  "#e879f9", // fuchsia
  "#22d3ee", // cyan bright
  "#facc15", // yellow
];

export function getClusterColor(clusterId: number): string {
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
}

export function getFileIcon(fileType: string): string {
  switch (fileType) {
    case "pdf":
      return "📄";
    case "txt":
    case "text":
      return "📝";
    case "md":
    case "markdown":
      return "📋";
    case "docx":
      return "📃";
    case "csv":
      return "📊";
    default:
      return "📎";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
