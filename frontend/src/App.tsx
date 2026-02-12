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
  Settings,
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
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
  moveFileToCluster,
  createCluster,
  renameCluster,
  deleteCluster,
} from "./api";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTheme } from "./hooks/useTheme";
import { GraphView } from "./views/GraphView";
import { SpatialView } from "./views/SpatialView";
import { Sidebar } from "./components/Sidebar";
import { EventFeed } from "./components/EventFeed";
import { ToastContainer, ToastMessage } from "./components/Toast";
import { SettingsModal } from "./components/SettingsModal";
import { ChatPanel } from "./components/ChatPanel";
import { MetricsPanel } from "./components/MetricsPanel";
import { notifyDesktop } from "./notifications";

let toastId = 0;

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
    root_folder: "",
    file_count: 0,
    cluster_count: 0,
    status: "connecting",
  });
  const [isReclustering, setIsReclustering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<WSEvent[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { isDark, toggleTheme } = useTheme();

  // Toast state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const addToast = useCallback(
    (type: ToastMessage["type"], message: string) => {
      const id = String(++toastId);
      setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    },
    [],
  );
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Chat panel
  const [chatOpen, setChatOpen] = useState(false);

  // New cluster modal
  const [newClusterOpen, setNewClusterOpen] = useState(false);
  const [newClusterName, setNewClusterName] = useState("");
  const newClusterInputRef = useRef<HTMLInputElement>(null);

  // Inline cluster rename in legend
  const [editingClusterId, setEditingClusterId] = useState<number | null>(null);
  const [editingClusterName, setEditingClusterName] = useState("");
  const editClusterInputRef = useRef<HTMLInputElement>(null);

  const notifyForEvent = useCallback((event: WSEvent) => {
    if (event.type === "file_added" && event.filename) {
      const details = [
        event.file_type?.toUpperCase(),
        event.word_count ? `${event.word_count.toLocaleString()} words` : "",
      ]
        .filter(Boolean)
        .join(" • ");
      void notifyDesktop(
        "SEFS: File Added",
        details ? `${event.filename} (${details})` : event.filename,
      );
      return;
    }
    if (event.type === "file_removed" && event.filename) {
      void notifyDesktop("SEFS: File Removed", event.filename);
      return;
    }
    if (event.type === "reclustering_end") {
      const count = event.cluster_count ?? 0;
      const moves = event.total_moves ?? 0;
      if (moves > 0) {
        const firstCluster = event.clusters?.[0]?.name;
        const clusterSuffix = firstCluster ? ` e.g. ${firstCluster}` : "";
        void notifyDesktop(
          "SEFS: Organization Complete",
          `Organized into ${count} groups (${moves} files moved)${clusterSuffix}`,
        );
      }
    }
  }, []);

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
      addToast("error", "Failed to connect to backend");
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  const handleWSEvent = useCallback(
    (event: WSEvent) => {
      setLiveEvents((prev) => [event, ...prev.slice(0, 49)]);
      notifyForEvent(event);
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
        case "file_moved":
        case "cluster_created":
        case "cluster_updated":
        case "cluster_deleted":
          clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(fetchData, 1000);
          break;
      }
    },
    [fetchData, notifyForEvent],
  );

  const { connected } = useWebSocket(handleWSEvent);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRescan = async () => {
    setIsReclustering(true);
    try {
      await rescan();
    } catch {
      addToast("error", "Rescan failed");
      setIsReclustering(false);
    }
  };

  // Semantic search with debounce
  const handleSearchChange = useCallback(
    (value: string) => {
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
          addToast("error", "Search failed");
        } finally {
          setIsSearching(false);
        }
      }, 400);
    },
    [addToast],
  );

  const openSearchOverlay = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

  const closeSearchOverlay = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const handleSelectNode = useCallback(
    (node: GraphNode) => {
      if (node.type === "file") {
        const full = graphData?.files.find((f) => f.file_id === node.file_id);
        if (full) {
          setSelectedNode(full as GraphNode);
          return;
        }
      }
      setSelectedNode(node);
    },
    [graphData],
  );

  // ─── Human Review Handlers ─────────────────────────────────

  const handleMoveFile = useCallback(
    async (fileId: number, clusterId: number) => {
      try {
        await moveFileToCluster(fileId, clusterId);
        addToast("success", "File moved successfully");
        fetchData();
      } catch (e: any) {
        addToast("error", e?.message || "Failed to move file");
      }
    },
    [addToast, fetchData],
  );

  const handleCreateCluster = useCallback(
    async (name: string) => {
      try {
        await createCluster(name);
        addToast("success", `Cluster "${name}" created`);
        setNewClusterOpen(false);
        setNewClusterName("");
        fetchData();
      } catch (e: any) {
        addToast("error", e?.message || "Failed to create cluster");
      }
    },
    [addToast, fetchData],
  );

  const handleRenameCluster = useCallback(
    async (clusterId: number, newName: string) => {
      try {
        await renameCluster(clusterId, newName);
        addToast("success", `Cluster renamed to "${newName}"`);
        fetchData();
      } catch (e: any) {
        addToast("error", e?.message || "Failed to rename cluster");
      }
    },
    [addToast, fetchData],
  );

  const handleDeleteCluster = useCallback(
    async (clusterId: number) => {
      try {
        await deleteCluster(clusterId);
        addToast("success", "Cluster deleted");
        fetchData();
      } catch (e: any) {
        addToast("error", e?.message || "Failed to delete cluster");
      }
    },
    [addToast, fetchData],
  );

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

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary cursor-pointer border-none hover:text-text-primary"
            style={{ background: "var(--bg-dark)" }}
            title="Settings"
          >
            <Settings size={16} />
          </button>

          <button
            onClick={() => setChatOpen((o) => !o)}
            className={`w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer border-none ${
              chatOpen
                ? "bg-accent text-white"
                : "text-text-secondary hover:text-text-primary"
            }`}
            style={chatOpen ? {} : { background: "var(--bg-dark)" }}
            title="Chat with files"
          >
            <MessageSquare size={16} />
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
        <div className="flex-1 min-w-0 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
                <span className="text-sm text-text-tertiary">
                  Loading files...
                </span>
              </div>
            </div>
          )}

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

          {!isLoading && (
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
                    onNodeClick={handleSelectNode}
                    onMoveFile={handleMoveFile}
                    onRenameCluster={handleRenameCluster}
                    onDeleteCluster={handleDeleteCluster}
                    searchQuery={searchQuery}
                    rootFolder={status.root_folder}
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
                    onNodeClick={handleSelectNode}
                    searchQuery={searchQuery}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* Cluster legend */}
          {graphData && graphData.clusters.length > 0 && (
            <div className="absolute bottom-14 left-4 flex flex-col gap-1 p-3 bg-bg-card border border-bg-border rounded-lg shadow-md text-xs max-h-48 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wider">
                  Clusters
                </span>
                <button
                  onClick={() => {
                    setNewClusterOpen(true);
                    setTimeout(() => newClusterInputRef.current?.focus(), 100);
                  }}
                  className="w-5 h-5 flex items-center justify-center rounded bg-bg-dark text-text-tertiary hover:text-accent hover:bg-accent/10 cursor-pointer border-none transition-colors"
                  title="Create new cluster"
                >
                  <Plus size={12} />
                </button>
              </div>
              {graphData.clusters.map((c) => (
                <div key={c.id} className="flex items-center gap-2 group">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                      background: getClusterColor(c.id),
                      border: c.is_manual ? `1.5px dashed ${getClusterColor(c.id)}` : "none",
                    }}
                  />
                  {editingClusterId === c.id ? (
                    <input
                      ref={editClusterInputRef}
                      className="flex-1 h-5 px-1.5 rounded text-xs bg-bg-dark text-text-primary border border-accent outline-none"
                      value={editingClusterName}
                      onChange={(e) => setEditingClusterName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editingClusterName.trim()) {
                          handleRenameCluster(c.id, editingClusterName.trim());
                          setEditingClusterId(null);
                        }
                        if (e.key === "Escape") setEditingClusterId(null);
                      }}
                      onBlur={() => setEditingClusterId(null)}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span
                        className="text-text-secondary flex-1 cursor-pointer"
                        onDoubleClick={() => {
                          setEditingClusterId(c.id);
                          setEditingClusterName(c.name);
                          setTimeout(() => editClusterInputRef.current?.focus(), 50);
                        }}
                        title="Double-click to rename"
                      >
                        {c.name}{" "}
                        <span className="text-text-tertiary">({c.file_count})</span>
                      </span>
                      <button
                        onClick={() => {
                          setEditingClusterId(c.id);
                          setEditingClusterName(c.name);
                          setTimeout(() => editClusterInputRef.current?.focus(), 50);
                        }}
                        className="w-4 h-4 items-center justify-center rounded bg-transparent text-text-tertiary hover:text-accent cursor-pointer border-none transition-colors hidden group-hover:flex"
                        title="Rename cluster"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        onClick={() => {
                          if (c.file_count > 0) {
                            addToast("error", `Cannot delete "${c.name}" — move files out first`);
                          } else {
                            handleDeleteCluster(c.id);
                          }
                        }}
                        className="w-4 h-4 items-center justify-center rounded bg-transparent text-text-tertiary hover:text-red-500 cursor-pointer border-none transition-colors hidden group-hover:flex"
                        title={c.file_count > 0 ? "Move files out first" : "Delete cluster"}
                      >
                        <Trash2 size={10} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Cluster legend — no clusters yet, still show create button */}
          {graphData && graphData.clusters.length === 0 && (
            <div className="absolute bottom-14 left-4 p-3 bg-bg-card border border-bg-border rounded-lg shadow-md text-xs">
              <button
                onClick={() => {
                  setNewClusterOpen(true);
                  setTimeout(() => newClusterInputRef.current?.focus(), 100);
                }}
                className="flex items-center gap-1.5 text-text-tertiary hover:text-accent cursor-pointer border-none bg-transparent text-xs"
              >
                <Plus size={12} />
                Create cluster
              </button>
            </div>
          )}

          {/* New Cluster popover */}
          {newClusterOpen && (
            <>
              <div
                className="fixed inset-0 z-[99]"
                onClick={() => { setNewClusterOpen(false); setNewClusterName(""); }}
              />
              <div
                className="absolute bottom-14 left-4 z-[100] w-64 p-3 rounded-xl shadow-xl"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--bg-border)",
                }}
              >
                <div className="text-xs font-semibold text-text-primary mb-2">New Cluster</div>
                <input
                  ref={newClusterInputRef}
                  className="w-full h-8 px-2.5 rounded-lg text-sm bg-bg-dark text-text-primary border border-bg-border outline-none focus:border-accent"
                  placeholder="Cluster name..."
                  value={newClusterName}
                  onChange={(e) => setNewClusterName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newClusterName.trim()) {
                      handleCreateCluster(newClusterName.trim());
                    }
                    if (e.key === "Escape") {
                      setNewClusterOpen(false);
                      setNewClusterName("");
                    }
                  }}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    className="px-2.5 py-1 text-xs rounded-lg bg-bg-dark text-text-secondary hover:text-text-primary cursor-pointer border-none"
                    onClick={() => { setNewClusterOpen(false); setNewClusterName(""); }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-2.5 py-1 text-xs rounded-lg bg-accent text-white cursor-pointer border-none hover:bg-accent-hover disabled:opacity-50"
                    disabled={!newClusterName.trim()}
                    onClick={() => {
                      if (newClusterName.trim()) handleCreateCluster(newClusterName.trim());
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Metrics Panel */}
          <MetricsPanel />
        </div>

        {/* Chat Panel */}
        <AnimatePresence>
          {chatOpen && (
            <ChatPanel
              onClose={() => setChatOpen(false)}
              onSelectFile={(fileId) => {
                const node = graphData?.files.find(
                  (f) => f.file_id === fileId,
                );
                if (node) setSelectedNode(node as GraphNode);
              }}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <Sidebar
          selectedNode={selectedNode}
          onClose={() => setSelectedNode(null)}
          onSelectNode={handleSelectNode}
          clusters={graphData?.clusters}
          onDataChange={fetchData}
        />
      </div>

      {/* Bottom Event Feed */}
      <EventFeed events={liveEvents} />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onToast={addToast}
      />
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
