import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, FileText, Tag, Clock, Link2 } from "lucide-react";
import { GraphNode, SEFSFile, getClusterColor, getFileIcon } from "../types";
import { openFile, getRelatedFiles, RelatedFile } from "../api";
import { useState, useEffect } from "react";

interface Props {
  selectedNode: GraphNode | null;
  onClose: () => void;
  onSelectNode?: (node: GraphNode) => void;
}

function isFile(node: GraphNode): node is SEFSFile {
  return node.type === "file";
}

export function Sidebar({ selectedNode, onClose, onSelectNode }: Props) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedFile[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  // Fetch related files when a file node is selected
  useEffect(() => {
    if (selectedNode && isFile(selectedNode) && selectedNode.file_id) {
      setLoadingRelated(true);
      getRelatedFiles(selectedNode.file_id, 5)
        .then(setRelated)
        .catch(() => setRelated([]))
        .finally(() => setLoadingRelated(false));
    } else {
      setRelated([]);
    }
  }, [selectedNode]);

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
