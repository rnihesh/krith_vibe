/* ─── Type definitions for SEFS ─── */

export interface SEFSFile {
  id: string;
  file_id: number;
  label: string;
  filename: string;
  cluster_id: number;
  x: number;
  y: number;
  file_type: string;
  size_bytes: number;
  word_count: number;
  page_count: number;
  summary: string;
  current_path: string;
  key_topics?: string[];
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
  files: SEFSFile[];
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
  timestamp?: string;
  file_id?: number;
  filename?: string;
  cluster_count?: number;
  root?: string;
  file_count?: number;
  detail?: string;
  data?: Record<string, any>;
  // Enriched event data (Phase 5)
  file_type?: string;
  word_count?: number;
  summary?: string;
  total_moves?: number;
  moves?: Array<{ file_id: number; from: string; to: string }>;
  clusters?: Array<{ cluster_id: number; name: string; file_count: number }>;
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

// Cluster color palette -- warm, professional tones
export const CLUSTER_COLORS = [
  "#d97757", // terracotta (accent)
  "#2563eb", // blue
  "#16a34a", // green
  "#9333ea", // purple
  "#d97706", // amber
  "#dc2626", // red
  "#0891b2", // cyan
  "#4f46e5", // indigo
  "#c026d3", // fuchsia
  "#059669", // emerald
];

export function getClusterColor(clusterId: number): string {
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
}

export function getFileIcon(fileType: string): string {
  switch (fileType) {
    case "pdf":
      return "PDF";
    case "txt":
    case "text":
      return "TXT";
    case "md":
    case "markdown":
      return "MD";
    case "docx":
      return "DOC";
    case "csv":
      return "CSV";
    default:
      return "FILE";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
