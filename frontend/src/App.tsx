/* SEFS Main Application -- Claude.ai inspired UI */
import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Network,
  Map,
  RotateCw,
  Wifi,
  WifiOff,
  Search,
  FolderOpen,
  FileText,
  Activity,
  Sun,
  Moon,
} from "lucide-react";
import {
  GraphData,
  GraphNode,
  WSEvent,
  ViewMode,
  EventLog,
  getClusterColor,
} from "./types";
import { getGraphData, getStatus, getEvents, rescan } from "./api";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { GraphView } from "./views/GraphView";
import { SpatialView } from "./views/SpatialView";
import { Sidebar } from "./components/Sidebar";
import { EventFeed } from "./components/EventFeed";

export default function App() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState({
    file_count: 0,
    cluster_count: 0,
    status: "connecting",
  });
  const [isReclustering, setIsReclustering] = useState(false);
  const [liveEvents, setLiveEvents] = useState<WSEvent[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { isDark, toggleTheme } = useTheme();

  const fetchData = useCallback(async () => {
    try {
      const [graph, st, ev] = await Promise.all([
        getGraphData(),
        getStatus(),
        getEvents(30),
      ]);
      setGraphData(graph);
      setStatus(st);
      setEvents(ev);
    } catch (e) {
      console.warn("Fetch failed:", e);
    }
  }, []);

  const handleWSEvent = useCallback(
    (event: WSEvent) => {
      setLiveEvents((prev) => [event, ...prev.slice(0, 49)]);
      switch (event.type) {
        case "reclustering_start":
          setIsReclustering(true);
          break;
        case "reclustering_end":
        case "scan_complete":
          setIsReclustering(false);
          clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(fetchData, 500);
          break;
        case "file_added":
        case "file_modified":
        case "file_removed":
          clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(fetchData, 1000);
          break;
      }
    },
    [fetchData],
  );

  const { connected } = useWebSocket(handleWSEvent);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRescan = async () => {
    setIsReclustering(true);
    await rescan();
  };

  return (
    <div className="flex flex-col h-screen bg-bg-main text-text-primary">
      {/* Top Bar */}
      <header
        className="flex items-center justify-between px-5 pr-6 py-0 border-b border-bg-border bg-bg-card"
        style={{ height: 56 }}
      >
        {/* Left section */}
        <div className="flex items-center gap-4 shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shadow-sm">
              <Network size={16} className="text-white" />
            </div>
            <span className="font-semibold text-[15px] tracking-tight text-text-primary">
              SEFS
            </span>
          </div>

          {/* View Toggle */}
          <div
            className="flex rounded-lg"
            style={{ border: "1px solid var(--bg-border)" }}
          >
            <ViewToggle
              active={viewMode === "graph"}
              onClick={() => setViewMode("graph")}
              icon={<Network size={14} />}
              label="Graph"
            />
            <ViewToggle
              active={viewMode === "spatial"}
              onClick={() => setViewMode("spatial")}
              icon={<Map size={14} />}
              label="Spatial"
            />
          </div>
        </div>

        {/* Center: Search */}
        <div className="flex-1 flex justify-center px-6">
          <div className="relative w-full max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg text-sm font-sans text-text-primary placeholder:text-text-tertiary focus:outline-none"
              style={{
                background: "var(--bg-dark)",
                border: "1px solid var(--bg-border)",
              }}
            />
          </div>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Stats */}
          <div className="flex items-center gap-4 text-[13px] text-text-secondary">
            <span className="flex items-center gap-1.5">
              <FileText size={14} className="text-text-tertiary" />
              <span>{status.file_count} files</span>
            </span>
            <span className="flex items-center gap-1.5">
              <FolderOpen size={14} className="text-text-tertiary" />
              <span>{status.cluster_count} clusters</span>
            </span>
          </div>

          {/* Rescan */}
          <button
            onClick={handleRescan}
            disabled={isReclustering}
            className={`flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-medium cursor-pointer border-none whitespace-nowrap ${
              isReclustering
                ? "bg-bg-dark text-text-tertiary cursor-wait"
                : "bg-accent hover:bg-accent-hover text-white shadow-sm"
            }`}
          >
            <RotateCw
              size={14}
              className={isReclustering ? "animate-spin-slow" : ""}
            />
            {isReclustering ? "Processing..." : "Rescan"}
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary cursor-pointer border-none"
            style={{ background: "var(--bg-dark)" }}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Connection status */}
          <div
            className={`flex items-center gap-1.5 text-[13px] ${
              connected ? "text-success" : "text-error"
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                connected ? "bg-success" : "bg-error"
              }`}
            />
            {connected ? "Live" : "Offline"}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Visualization */}
        <div className="flex-1 relative">
          {isReclustering && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 bg-bg-card border border-bg-border rounded-lg shadow-md text-sm text-text-secondary"
            >
              <Activity size={14} className="animate-spin-slow text-accent" />
              Reclustering files...
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {viewMode === "graph" ? (
              <motion.div
                key="graph"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                <GraphView
                  data={graphData}
                  onNodeClick={setSelectedNode}
                  searchQuery={searchQuery}
                />
              </motion.div>
            ) : (
              <motion.div
                key="spatial"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                <SpatialView
                  data={graphData}
                  onNodeClick={setSelectedNode}
                  searchQuery={searchQuery}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Cluster legend */}
          {graphData && graphData.clusters.length > 0 && (
            <div className="absolute bottom-14 left-4 flex flex-col gap-1 p-3 bg-bg-card border border-bg-border rounded-lg shadow-md text-xs max-h-48 overflow-y-auto">
              <span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wider mb-1">
                Clusters
              </span>
              {graphData.clusters.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: getClusterColor(c.id) }}
                  />
                  <span className="text-text-secondary">
                    {c.name}{" "}
                    <span className="text-text-tertiary">({c.file_count})</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <Sidebar
          selectedNode={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      </div>

      {/* Bottom Event Feed */}
      <EventFeed events={liveEvents} />
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium cursor-pointer border-none whitespace-nowrap first:rounded-l-md last:rounded-r-md ${
        active
          ? "bg-accent text-white"
          : "bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-dark"
      }`}
    >
      {icon} {label}
    </button>
  );
}
