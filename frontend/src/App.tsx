/* SEFS Main Application -- Claude.ai inspired UI */
import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Network,
  Map,
  RotateCw,
  Search,
  FolderOpen,
  FileText,
  Activity,
  Sun,
  Moon,
  X,
  Sparkles,
} from "lucide-react";
import {
  GraphData,
  GraphNode,
  WSEvent,
  ViewMode,
  EventLog,
  getClusterColor,
} from "./types";
import {
  getGraphData,
  getStatus,
  getEvents,
  rescan,
  semanticSearch,
  SearchResult,
} from "./api";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
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

  // Semantic search with debounce
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(searchDebounce.current);
    if (!value.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const results = await semanticSearch(value.trim());
        setSearchResults(results);
      } catch (e) {
        console.warn("Search failed:", e);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }, []);

  const openSearchOverlay = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

  const closeSearchOverlay = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

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
            <img
              src="/sefs.svg"
              alt="SEFS"
              className="w-8 h-8 rounded-lg shadow-sm"
            />
            {/* <span className="font-semibold text-[15px] tracking-tight text-text-primary">
              SEFS
            </span> */}
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

        {/* Center: Search trigger pill */}
        <div className="flex-1 flex justify-center px-6">
          <button
            onClick={openSearchOverlay}
            className="flex items-center gap-2 h-9 px-4 rounded-xl text-sm text-text-tertiary cursor-pointer border-none"
            style={{
              background: "var(--bg-dark)",
              border: "1px solid var(--bg-border)",
              minWidth: 260,
            }}
          >
            <Search size={14} />
            <span className="flex-1 text-left">
              Search files semantically...
            </span>
            <kbd
              className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--bg-border)",
                color: "var(--text-tertiary)",
              }}
            >
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-3 shrink-0">
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

          <button
            onClick={toggleTheme}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary cursor-pointer border-none"
            style={{ background: "var(--bg-dark)" }}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

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

      {/* ── Search Overlay (command-palette style) ── */}
      <AnimatePresence>
        {searchOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-100"
              style={{
                background: "rgba(0,0,0,0.4)",
                backdropFilter: "blur(4px)",
              }}
              onClick={closeSearchOverlay}
            />
            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-101 left-1/2 -translate-x-1/2 w-full max-w-xl"
              style={{ top: "15vh" }}
            >
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--bg-border)",
                  boxShadow: "0 25px 60px rgba(0,0,0,0.25)",
                }}
              >
                {/* Search input */}
                <div
                  className="flex items-center gap-3 px-5 h-14 border-b"
                  style={{ borderColor: "var(--bg-border)" }}
                >
                  <Sparkles size={18} className="text-accent shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Describe what you're looking for..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Escape" && closeSearchOverlay()
                    }
                    className="flex-1 bg-transparent border-none outline-none text-[15px] text-text-primary placeholder:text-text-tertiary"
                  />
                  {isSearching && (
                    <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
                  )}
                  <button
                    onClick={closeSearchOverlay}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary cursor-pointer border-none bg-transparent"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Results */}
                <div className="max-h-[45vh] overflow-y-auto">
                  {searchQuery &&
                    searchResults.length === 0 &&
                    !isSearching && (
                      <div className="px-5 py-8 text-center text-text-tertiary text-sm">
                        No matching files found.
                      </div>
                    )}
                  {!searchQuery && (
                    <div className="px-5 py-8 text-center text-text-tertiary text-sm">
                      <p className="mb-1">
                        Search semantically across your files
                      </p>
                      <p className="text-xs">
                        Try: "my C++ code", "cooking recipes", "employment
                        documents"
                      </p>
                    </div>
                  )}
                  {searchResults.map((r, i) => (
                    <button
                      key={r.file_id}
                      onClick={() => {
                        // Find the matching node in graphData and select it
                        const node = graphData?.files.find(
                          (f) => f.file_id === r.file_id,
                        );
                        if (node) setSelectedNode(node as GraphNode);
                        closeSearchOverlay();
                      }}
                      className="w-full flex items-start gap-3 px-5 py-3 text-left cursor-pointer border-none bg-transparent hover:bg-bg-dark transition-colors"
                      style={{
                        borderBottom:
                          i < searchResults.length - 1
                            ? "1px solid var(--bg-border)"
                            : "none",
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-full mt-2 shrink-0"
                        style={{
                          background: getClusterColor(r.cluster_id),
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-text-primary truncate">
                            {r.filename}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0"
                            style={{
                              background: "var(--accent-light)",
                              color: "var(--accent)",
                            }}
                          >
                            {(r.score * 100).toFixed(0)}%
                          </span>
                        </div>
                        {r.summary && (
                          <p className="text-xs text-text-tertiary line-clamp-2 m-0">
                            {r.summary.slice(0, 120)}
                            {r.summary.length > 120 ? "..." : ""}
                          </p>
                        )}
                      </div>
                      <span className="text-[11px] text-text-tertiary uppercase shrink-0 mt-0.5">
                        {r.file_type}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Keyboard shortcut: ⌘K */}
      <KeyboardShortcut
        combo="k"
        onTrigger={() => {
          if (searchOpen) closeSearchOverlay();
          else openSearchOverlay();
        }}
      />
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

function KeyboardShortcut({
  combo,
  onTrigger,
}: {
  combo: string;
  onTrigger: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === combo) {
        e.preventDefault();
        onTrigger();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [combo, onTrigger]);
  return null;
}
