import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, FileText, Tag, Clock, Link2, Pin, PinOff, ArrowRightLeft } from "lucide-react";
import { GraphNode, SEFSFile, ClusterInfo, getClusterColor, getFileIcon } from "../types";
import { openFile, getRelatedFiles, RelatedFile, pinFile, unpinFile, moveFileToCluster } from "../api";
import { useState, useEffect } from "react";

interface Props {
  selectedNode: GraphNode | null;
  onClose: () => void;
  onSelectNode?: (node: GraphNode) => void;
  clusters?: ClusterInfo[];
  onDataChange?: () => void;
}

function isFile(node: GraphNode): node is SEFSFile {
  return node.type === "file";
}

export function Sidebar({ selectedNode, onClose, onSelectNode, clusters, onDataChange }: Props) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedFile[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  // Fetch related files when a file node is selected
  useEffect(() => {
    if (selectedNode && isFile(selectedNode) && selectedNode.file_id) {
      setLoadingRelated(true);
      setIsPinned(!!selectedNode.pinned);
      setMoveOpen(false);
      getRelatedFiles(selectedNode.file_id, 5)
        .then(setRelated)
        .catch(() => setRelated([]))
        .finally(() => setLoadingRelated(false));
    } else {
      setRelated([]);
      setMoveOpen(false);
    }
  }, [selectedNode]);

  const handleTogglePin = async () => {
    if (!selectedNode || !isFile(selectedNode)) return;
    try {
      if (isPinned) {
        await unpinFile(selectedNode.file_id);
        setIsPinned(false);
      } else {
        await pinFile(selectedNode.file_id);
        setIsPinned(true);
      }
      onDataChange?.();
    } catch (e) {
      // silent
    }
  };

  const handleMoveToCluster = async (clusterId: number) => {
    if (!selectedNode || !isFile(selectedNode)) return;
    setMoving(true);
    try {
      await moveFileToCluster(selectedNode.file_id, clusterId);
      setMoveOpen(false);
      onDataChange?.();
    } catch (e) {
      // silent
    } finally {
      setMoving(false);
    }
  };

  const handleOpen = async () => {
    if (!selectedNode || !isFile(selectedNode)) return;
    setOpening(true);
    setOpenError(null);
    try {
      await openFile(selectedNode.file_id);
    } catch (e: any) {
      setOpenError(e?.message || "Failed to open file");
    } finally {
      setOpening(false);
    }
  };

  return (
    <AnimatePresence>
      {selectedNode && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 340, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="h-full border-l border-bg-border bg-bg-card overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
            <h3 className="font-semibold text-sm text-text-primary truncate pr-2">
              {isFile(selectedNode) ? "File Details" : "Cluster Details"}
            </h3>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-bg-dark text-text-tertiary cursor-pointer border-none bg-transparent"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {/* File name */}
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{
                  backgroundColor: getClusterColor(
                    selectedNode.cluster_id ?? 0,
                  ),
                }}
              >
                {isFile(selectedNode)
                  ? getFileIcon(selectedNode.file_type || "")
                  : "C"}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-text-primary text-sm break-all">
                  {isFile(selectedNode)
                    ? selectedNode.filename
                    : selectedNode.label}
                </div>
                {isFile(selectedNode) && (
                  <div className="text-xs text-text-tertiary mt-0.5">
                    {selectedNode.file_type?.toUpperCase()} • ID:{" "}
                    {selectedNode.file_id}
                  </div>
                )}
                {!isFile(selectedNode) && (
                  <div className="text-xs text-text-tertiary mt-0.5">
                    Cluster • {(selectedNode as any).file_count} files
                  </div>
                )}
              </div>
            </div>

            {/* Cluster badge */}
            {selectedNode.cluster_id != null && (
              <div className="flex items-center gap-2">
                <Tag size={13} className="text-text-tertiary" />
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    color: getClusterColor(selectedNode.cluster_id),
                    backgroundColor:
                      getClusterColor(selectedNode.cluster_id) + "15",
                  }}
                >
                  Cluster {selectedNode.cluster_id}
                </span>
              </div>
            )}

            {/* Pin status + Move to cluster (file nodes only) */}
            {isFile(selectedNode) && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTogglePin}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg cursor-pointer border-none transition-colors ${
                    isPinned
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-bg-dark text-text-tertiary hover:text-text-secondary"
                  }`}
                  title={isPinned ? "Unpin — allow auto-recluster to move this file" : "Pin — prevent auto-recluster from moving this file"}
                >
                  {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
                  {isPinned ? "Pinned" : "Pin"}
                </button>
                <button
                  onClick={() => setMoveOpen(!moveOpen)}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-bg-dark text-text-tertiary hover:text-text-secondary cursor-pointer border-none transition-colors"
                  title="Move to different cluster"
                >
                  <ArrowRightLeft size={12} />
                  Move
                </button>
              </div>
            )}

            {/* Move-to-cluster dropdown */}
            {isFile(selectedNode) && moveOpen && clusters && (
              <div className="bg-bg-dark rounded-lg p-1">
                <div className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wider px-2 py-1">
                  Move to cluster
                </div>
                {clusters.filter((c) => c.id !== selectedNode.cluster_id).map((c) => (
                  <button
                    key={c.id}
                    disabled={moving}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-text-primary hover:bg-bg-card cursor-pointer border-none bg-transparent text-left disabled:opacity-50"
                    onClick={() => handleMoveToCluster(c.id)}
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: getClusterColor(c.id) }}
                    />
                    <span className="truncate">{c.name}</span>
                    <span className="text-text-tertiary ml-auto">({c.file_count})</span>
                  </button>
                ))}
                {clusters.filter((c) => c.id !== selectedNode.cluster_id).length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-text-tertiary">No other clusters</div>
                )}
              </div>
            )}

            {/* Cluster Description (for cluster nodes) */}
            {!isFile(selectedNode) && (selectedNode as any).description && (
              <div>
                <div className="text-xs text-text-tertiary font-semibold uppercase tracking-wider mb-1.5">
                  Description
                </div>
                <div className="text-sm text-text-secondary leading-relaxed">
                  {(selectedNode as any).description}
                </div>
              </div>
            )}

            {/* Summary (for file nodes) */}
            {isFile(selectedNode) && selectedNode.summary && (
              <div>
                <div className="text-xs text-text-tertiary font-semibold uppercase tracking-wider mb-1.5">
                  Summary
                </div>
                <div className="text-sm text-text-secondary leading-relaxed">
                  {selectedNode.summary}
                </div>
              </div>
            )}

            {/* Key Topics */}
            {isFile(selectedNode) &&
              selectedNode.key_topics &&
              selectedNode.key_topics.length > 0 && (
                <div>
                  <div className="text-xs text-text-tertiary font-semibold uppercase tracking-wider mb-1.5">
                    Key Topics
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedNode.key_topics.map((topic: string, i: number) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-bg-dark text-text-secondary text-xs rounded-md"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            {/* File path */}
            {isFile(selectedNode) && selectedNode.current_path && (
              <div>
                <div className="text-xs text-text-tertiary font-semibold uppercase tracking-wider mb-1.5">
                  Path
                </div>
                <div className="text-xs text-text-secondary bg-bg-dark px-2.5 py-1.5 rounded-md break-all font-mono">
                  {selectedNode.current_path}
                </div>
              </div>
            )}

            {/* ── Related Files ── */}
            {isFile(selectedNode) && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Link2 size={12} className="text-text-tertiary" />
                  <span className="text-xs text-text-tertiary font-semibold uppercase tracking-wider">
                    Related Files
                  </span>
                </div>
                {loadingRelated && (
                  <div className="flex items-center gap-2 py-2">
                    <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin-slow" />
                    <span className="text-xs text-text-tertiary">
                      Finding related...
                    </span>
                  </div>
                )}
                {!loadingRelated && related.length === 0 && (
                  <p className="text-xs text-text-tertiary py-1">
                    No related files found
                  </p>
                )}
                {!loadingRelated && related.length > 0 && (
                  <div className="space-y-1">
                    {related.map((r) => (
                      <button
                        key={r.file_id}
                        onClick={() => {
                          if (onSelectNode) {
                            // Construct a minimal GraphNode to navigate
                            onSelectNode({
                              id: `file-${r.file_id}`,
                              file_id: r.file_id,
                              filename: r.filename,
                              label: r.filename,
                              cluster_id: r.cluster_id,
                              type: "file",
                              summary: r.summary,
                            } as any);
                          }
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left cursor-pointer border-none bg-transparent hover:bg-bg-dark transition-colors"
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            background: getClusterColor(r.cluster_id),
                          }}
                        />
                        <span className="flex-1 text-xs text-text-primary truncate">
                          {r.filename}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0 rounded font-mono shrink-0"
                          style={{
                            background: "var(--accent-light)",
                            color: "var(--accent)",
                          }}
                        >
                          {(r.similarity * 100).toFixed(0)}%
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Open button */}
          {isFile(selectedNode) && (
            <div className="px-4 py-3 border-t border-bg-border">
              <button
                onClick={handleOpen}
                disabled={opening}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium cursor-pointer border-none ${
                  opening
                    ? "bg-bg-dark text-text-tertiary cursor-wait"
                    : "bg-accent hover:bg-accent-hover text-white"
                }`}
              >
                <ExternalLink size={14} />
                {opening ? "Opening..." : "Open File"}
              </button>
              {openError && (
                <p className="text-xs text-error mt-2 text-center">
                  {openError}
                </p>
              )}
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
