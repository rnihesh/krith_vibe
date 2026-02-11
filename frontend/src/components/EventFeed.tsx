import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  FolderPlus,
  RefreshCw,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { WSEvent } from "../types";
import { useState } from "react";

interface Props {
  events: WSEvent[];
}

const eventIcons: Record<string, React.ReactNode> = {
  file_added: <FolderPlus size={12} className="text-success" />,
  file_modified: <RefreshCw size={12} className="text-accent" />,
  file_removed: <Trash2 size={12} className="text-error" />,
  scan_complete: <CheckCircle size={12} className="text-success" />,
  reclustering_start: <RefreshCw size={12} className="text-warning" />,
  reclustering_end: <CheckCircle size={12} className="text-success" />,
  error: <AlertTriangle size={12} className="text-error" />,
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function eventMessage(event: WSEvent): string {
  switch (event.type) {
    case "file_added":
      return `Added: ${event.data?.filename || "file"}`;
    case "file_modified":
      return `Modified: ${event.data?.filename || "file"}`;
    case "file_removed":
      return `Removed: ${event.data?.filename || "file"}`;
    case "scan_complete":
      return `Scan complete (${event.data?.total_files || 0} files)`;
    case "reclustering_start":
      return "Reclustering started...";
    case "reclustering_end":
      return `Reclustered into ${event.data?.cluster_count || 0} groups`;
    case "error":
      return `Error: ${event.data?.message || "unknown"}`;
    default:
      return event.type;
  }
}

export function EventFeed({ events }: Props) {
  const [expanded, setExpanded] = useState(false);
  const displayEvents = expanded ? events.slice(0, 20) : events.slice(0, 3);

  if (events.length === 0) return null;

  return (
    <div className="border-t border-bg-border bg-bg-card">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-1.5 text-xs text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none font-sans"
      >
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-success" />
          Activity ({events.length})
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      <AnimatePresence>
        {displayEvents.length > 0 && (
          <motion.div
            initial={false}
            animate={{ height: "auto" }}
            className="px-4 pb-2 flex flex-wrap gap-1.5 overflow-hidden"
          >
            {displayEvents.map((event, i) => (
              <motion.div
                key={`${event.type}-${event.timestamp}-${i}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1.5 px-2 py-1 bg-bg-dark rounded-md text-xs text-text-secondary"
              >
                {eventIcons[event.type] || (
                  <Info size={12} className="text-info" />
                )}
                <span>{eventMessage(event)}</span>
                {event.timestamp && (
                  <span className="text-text-tertiary ml-1">
                    {formatTime(event.timestamp)}
                  </span>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
