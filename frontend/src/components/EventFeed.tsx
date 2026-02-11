/* ─── Live Event Feed (bottom bar) ─── */
import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WSEvent } from "../types";
import {
  FilePlus,
  FileEdit,
  FileX,
  RefreshCw,
  Search,
  CheckCircle,
  Loader,
} from "lucide-react";

interface Props {
  events: WSEvent[];
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  file_added: <FilePlus size={11} color="var(--accent-green)" />,
  file_modified: <FileEdit size={11} color="var(--accent-amber)" />,
  file_removed: <FileX size={11} color="var(--accent-red)" />,
  reclustering_start: <RefreshCw size={11} color="var(--accent-blue)" />,
  reclustering_end: <CheckCircle size={11} color="var(--accent-green)" />,
  scan_start: <Search size={11} color="var(--accent-cyan)" />,
  scan_complete: <CheckCircle size={11} color="var(--accent-green)" />,
  processing_start: <Loader size={11} color="var(--accent-purple)" />,
};

const EVENT_LABELS: Record<string, (e: WSEvent) => string> = {
  file_added: (e) => `Added: ${e.filename}`,
  file_modified: (e) => `Modified: ${e.filename}`,
  file_removed: (e) => `Removed: ${e.filename}`,
  reclustering_start: () => "Reclustering files...",
  reclustering_end: (e) => `Reclustered into ${e.cluster_count} groups`,
  scan_start: () => "Scanning root folder...",
  scan_complete: (e) => `Scan complete: ${e.file_count} files`,
  processing_start: (e) => `Processing: ${e.filename}`,
};

export function EventFeed({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-color)",
        background: "var(--bg-secondary)",
        padding: "6px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 32,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: 1,
          flexShrink: 0,
        }}
      >
        Live
      </span>
      <div
        style={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "var(--accent-green)",
          animation: "pulseGlow 2s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          gap: 10,
          overflow: "hidden",
          flex: 1,
        }}
      >
        <AnimatePresence>
          {events.slice(0, 10).map((event, i) => (
            <motion.div
              key={`${event.type}-${i}-${event.filename ?? ""}`}
              initial={{ opacity: 0, x: -20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                flexShrink: 0,
                padding: "2px 8px",
                background: "var(--bg-tertiary)",
                borderRadius: 4,
              }}
            >
              {EVENT_ICONS[event.type] ?? null}
              {(EVENT_LABELS[event.type] ?? (() => event.type))(event)}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
