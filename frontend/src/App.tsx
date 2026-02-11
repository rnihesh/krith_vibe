/* ─── SEFS Main Application ─── */
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Network,
  Map,
  RotateCw,
  Wifi,
  WifiOff,
  Search,
  FolderOpen,
  Zap,
  FileText,
  Activity,
} from "lucide-react";
import {
  GraphData,
  GraphNode,
  SEFSFile,
  WSEvent,
  ViewMode,
  EventLog,
  getClusterColor,
} from "./types";
import { getGraphData, getStatus, getEvents, rescan } from "./api";
import { useWebSocket } from "./hooks/useWebSocket";
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

  // Fetch data
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

  // WebSocket events
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
          // Debounce refresh
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

  const { connected, send } = useWebSocket(handleWSEvent);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRescan = async () => {
    setIsReclustering(true);
    await rescan();
  };

  const filteredNodes = graphData?.nodes.filter(
    (n) =>
      !searchQuery || n.label.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-primary)",
      }}
    >
      {/* ─── Top Bar ─── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginRight: 8,
          }}
        >
          <Zap size={22} color="var(--accent-blue)" />
          <span
            style={{
              fontWeight: 700,
              fontSize: 18,
              background:
                "linear-gradient(135deg, var(--accent-blue), var(--accent-purple))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "-0.5px",
            }}
          >
            SEFS
          </span>
        </div>

        {/* View Toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
            padding: 3,
            gap: 2,
          }}
        >
          <ViewToggle
            active={viewMode === "graph"}
            onClick={() => setViewMode("graph")}
            icon={<Network size={15} />}
            label="Graph"
          />
          <ViewToggle
            active={viewMode === "spatial"}
            onClick={() => setViewMode("spatial")}
            icon={<Map size={15} />}
            label="Spatial"
          />
        </div>

        {/* Search */}
        <div
          style={{
            flex: 1,
            maxWidth: 400,
            position: "relative",
          }}
        >
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
            }}
          />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 12px 7px 32px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              color: "var(--text-primary)",
              fontSize: 13,
              fontFamily: "var(--font-sans)",
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--accent-blue)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
          />
        </div>

        <div style={{ flex: 1 }} />

        {/* Stats */}
        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <FileText size={13} /> {status.file_count} files
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <FolderOpen size={13} /> {status.cluster_count} clusters
          </span>
        </div>

        {/* Actions */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleRescan}
          disabled={isReclustering}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: isReclustering
              ? "var(--bg-tertiary)"
              : "linear-gradient(135deg, var(--accent-blue), var(--accent-purple))",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            fontSize: 12,
            fontWeight: 500,
            cursor: isReclustering ? "wait" : "pointer",
            fontFamily: "var(--font-sans)",
          }}
        >
          <RotateCw
            size={13}
            className={isReclustering ? "spin" : ""}
            style={{
              animation: isReclustering ? "spin 1s linear infinite" : "none",
            }}
          />
          {isReclustering ? "Processing..." : "Rescan"}
        </motion.button>

        {/* Connection status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: connected ? "var(--accent-green)" : "var(--accent-red)",
          }}
        >
          {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {connected ? "Live" : "Offline"}
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Visualization */}
        <div style={{ flex: 1, position: "relative" }}>
          {isReclustering && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: "absolute",
                top: 16,
                left: "50%",
                transform: "translateX(-50%)",
                padding: "8px 20px",
                background: "rgba(99, 102, 241, 0.15)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                borderRadius: 20,
                color: "var(--accent-blue)",
                fontSize: 13,
                fontWeight: 500,
                zIndex: 50,
                display: "flex",
                alignItems: "center",
                gap: 8,
                backdropFilter: "blur(8px)",
              }}
            >
              <Activity
                size={14}
                style={{ animation: "spin 2s linear infinite" }}
              />
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
                style={{ width: "100%", height: "100%" }}
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
                style={{ width: "100%", height: "100%" }}
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
            <div
              style={{
                position: "absolute",
                bottom: 50,
                left: 16,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "10px 14px",
                background: "var(--bg-glass)",
                backdropFilter: "blur(12px)",
                borderRadius: 10,
                border: "1px solid var(--border-color)",
                fontSize: 11,
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Clusters
              </span>
              {graphData.clusters.map((c) => (
                <div
                  key={c.id}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: getClusterColor(c.id),
                      boxShadow: `0 0 6px ${getClusterColor(c.id)}50`,
                    }}
                  />
                  <span style={{ color: "var(--text-secondary)" }}>
                    {c.name}{" "}
                    <span style={{ color: "var(--text-muted)" }}>
                      ({c.file_count})
                    </span>
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

      {/* ─── Bottom Event Feed ─── */}
      <EventFeed events={liveEvents} />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 12px",
        background: active
          ? "linear-gradient(135deg, var(--accent-blue), var(--accent-purple))"
          : "transparent",
        border: "none",
        borderRadius: 6,
        color: active ? "#fff" : "var(--text-secondary)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.2s",
        fontFamily: "var(--font-sans)",
      }}
    >
      {icon} {label}
    </button>
  );
}
