/* ─── Sidebar: File Inspector ─── */
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  FileText,
  FolderOpen,
  Hash,
  Calendar,
  Type,
  BookOpen,
  Layers,
  ExternalLink,
} from "lucide-react";
import {
  GraphNode,
  SEFSFile,
  getClusterColor,
  getFileIcon,
  formatBytes,
} from "../types";

interface Props {
  selectedNode: GraphNode | null;
  onClose: () => void;
}

export function Sidebar({ selectedNode, onClose }: Props) {
  return (
    <AnimatePresence>
      {selectedNode && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          style={{
            height: "100%",
            borderLeft: "1px solid var(--border-color)",
            background: "var(--bg-secondary)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: 16,
              overflowY: "auto",
              flex: 1,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: 1,
                }}
              >
                <span style={{ fontSize: 24 }}>
                  {selectedNode.type === "file"
                    ? getFileIcon((selectedNode as SEFSFile).file_type)
                    : "📁"}
                </span>
                <div style={{ minWidth: 0 }}>
                  <h3
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 220,
                    }}
                  >
                    {selectedNode.label}
                  </h3>
                  <span
                    style={{
                      fontSize: 11,
                      color: getClusterColor(selectedNode.cluster_id),
                      fontWeight: 500,
                    }}
                  >
                    {selectedNode.type === "file" ? "Document" : "Cluster"}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "none",
                  borderRadius: 6,
                  padding: 4,
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  display: "flex",
                }}
              >
                <X size={14} />
              </button>
            </div>

            {selectedNode.type === "file" && (
              <FileDetails file={selectedNode as SEFSFile} />
            )}
            {selectedNode.type === "cluster" && (
              <ClusterDetails cluster={selectedNode} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FileDetails({ file }: { file: SEFSFile }) {
  const openFile = () => {
    // In Electron, this would use shell.openPath
    // In web, we can't open local files directly
    console.log("Open file:", file.current_path);
  };

  return (
    <div
      className="animate-fade-in"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {/* Summary */}
      {file.summary && (
        <Section title="Summary" icon={<BookOpen size={13} />}>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}
          >
            {file.summary}
          </p>
        </Section>
      )}

      {/* Metadata Grid */}
      <Section title="Details" icon={<FileText size={13} />}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <MetadataItem label="Type" value={file.file_type.toUpperCase()} />
          <MetadataItem label="Size" value={formatBytes(file.size_bytes)} />
          <MetadataItem
            label="Words"
            value={file.word_count.toLocaleString()}
          />
          <MetadataItem label="Pages" value={String(file.page_count)} />
        </div>
      </Section>

      {/* Cluster */}
      <Section title="Cluster" icon={<Layers size={13} />}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: getClusterColor(file.cluster_id),
              boxShadow: `0 0 8px ${getClusterColor(file.cluster_id)}50`,
            }}
          />
          <span style={{ fontSize: 12 }}>Cluster {file.cluster_id}</span>
        </div>
      </Section>

      {/* Path */}
      <Section title="Location" icon={<FolderOpen size={13} />}>
        <p
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            wordBreak: "break-all",
            lineHeight: 1.5,
          }}
        >
          {file.current_path}
        </p>
      </Section>

      {/* Open button */}
      <button
        onClick={openFile}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "10px 16px",
          background:
            "linear-gradient(135deg, var(--accent-blue), var(--accent-purple))",
          border: "none",
          borderRadius: 8,
          color: "#fff",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
          marginTop: 4,
        }}
      >
        <ExternalLink size={14} />
        Open File
      </button>
    </div>
  );
}

function ClusterDetails({ cluster }: { cluster: GraphNode }) {
  return (
    <div
      className="animate-fade-in"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Section title="Info" icon={<Layers size={13} />}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <MetadataItem label="ID" value={String(cluster.cluster_id)} />
          <MetadataItem
            label="Files"
            value={String((cluster as any).file_count ?? 0)}
          />
        </div>
      </Section>
      {(cluster as any).description && (
        <Section title="Description" icon={<BookOpen size={13} />}>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {(cluster as any).description}
          </p>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "6px 10px",
        background: "var(--bg-tertiary)",
        borderRadius: 6,
      }}
    >
      <div
        style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
