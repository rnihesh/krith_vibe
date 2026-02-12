import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import * as d3Force from "d3-force";
import forceClustering from "d3-force-clustering";
import { ZoomIn, ZoomOut, Maximize2, Crosshair } from "lucide-react";
import { GraphData, GraphNode, getClusterColor } from "../types";

interface Props {
  data: GraphData | null;
  onNodeClick: (node: GraphNode) => void;
  searchQuery: string;
  rootFolder?: string;
}

export function GraphView({ data, onNodeClick, searchQuery, rootFolder }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isDark, setIsDark] = useState(
    document.documentElement.classList.contains("dark"),
  );
  const hasZoomedToFit = useRef(false);
  const prevDataKey = useRef<string>("");

  // Watch for dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Resize
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Build a stable data key so we only rebuild graph data when actual content changes
  const dataKey = useMemo(() => {
    if (!data) return "";
    const fileIds = data.files
      .map((f) => f.file_id)
      .sort()
      .join(",");
    const clusterIds = data.clusters
      .map((c) => c.id)
      .sort()
      .join(",");
    return `${fileIds}|${clusterIds}`;
  }, [data]);

  // Stable graph data — only rebuild when dataKey changes (new files/clusters)
  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as any[], links: [] as any[] };

    const nodes = [
      ...data.clusters.map((c) => ({
        id: `cluster-${c.id}`,
        type: "cluster" as const,
        label: c.name,
        clusterId: c.id,
        cluster_id: c.id,
        val: 1,
        file_count: c.file_count,
        description: c.description,
      })),
      ...data.files.map((f) => ({
        id: `file-${f.file_id}`,
        type: "file" as const,
        label: f.label,
        clusterId: f.cluster_id,
        cluster_id: f.cluster_id,
        val: 1,
        file_id: f.file_id,
        filename: f.filename,
        summary: f.summary,
        current_path: f.current_path,
        file_type: f.file_type,
        size_bytes: f.size_bytes,
        word_count: f.word_count,
        page_count: f.page_count,
        key_topics: f.key_topics,
      })),
    ];

    // Only link files that belong to a real cluster (skip noise cluster_id = -1)
    const validClusterIds = new Set(data.clusters.map((c) => c.id));
    const links = data.files
      .filter((f) => validClusterIds.has(f.cluster_id))
      .map((f) => ({
        source: `file-${f.file_id}`,
        target: `cluster-${f.cluster_id}`,
      }));

    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // Reset zoom-to-fit flag when data changes so onEngineStop triggers it
  useEffect(() => {
    if (graphData.nodes.length > 0 && dataKey !== prevDataKey.current) {
      prevDataKey.current = dataKey;
      hasZoomedToFit.current = false;
    }
  }, [dataKey, graphData.nodes.length]);

  const handleEngineStop = useCallback(() => {
    // Engine won't stop with Infinity cooldown, but keep as safety
    if (!hasZoomedToFit.current && graphRef.current) {
      graphRef.current.zoomToFit(400, 80);
      hasZoomedToFit.current = true;
    }
  }, []);

  // Configure d3 forces — modify existing forces (don't replace link/charge
  // since react-force-graph already wired them up with graph data)
  useEffect(() => {
    if (!graphRef.current) return;
    const fg = graphRef.current;

    // Modify existing center force
    const center = fg.d3Force("center") as any;
    if (center) center.strength(0.08);

    // Moderate repulsion — low enough so clusters stay compact
    const charge = fg.d3Force("charge") as any;
    if (charge) charge.strength(-80).distanceMax(200);

    // Short links pull files close to their cluster center
    const link = fg.d3Force("link") as any;
    if (link) link.distance(25).strength(1.2);

    // Collision — just enough to prevent overlap
    fg.d3Force(
      "collide",
      d3Force
        .forceCollide()
        .radius((d: any) => (d.type === "cluster" ? 15 : 5))
        .strength(0.8),
    );

    // Cluster-pull force: pulls file nodes toward their cluster center
    fg.d3Force(
      "cluster",
      forceClustering()
        .clusterId((d: any) => d.cluster_id)
        .strength(0.3),
    );

    fg.d3ReheatSimulation();
  }, [graphData]);

  // Pin node after drag, then release so it rejoins the simulation
  const handleNodeDragEnd = useCallback((node: any) => {
    node.fx = node.x;
    node.fy = node.y;
    setTimeout(() => {
      node.fx = undefined;
      node.fy = undefined;
    }, 5000);
  }, []);

  const matchesSearch = useCallback(
    (label: string) => {
      if (!searchQuery) return true;
      return label.toLowerCase().includes(searchQuery.toLowerCase());
    },
    [searchQuery],
  );

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const color = getClusterColor(node.clusterId ?? 0);
      const matches = matchesSearch(node.label || "");
      const alpha = matches ? 1 : 0.15;

      ctx.globalAlpha = alpha;

      if (node.type === "cluster") {
        // Center dot only — no large transparent circles
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label — positioned just above center dot
        const fontSize = Math.min(Math.max(13 / globalScale, 4), 16);
        ctx.font = `700 ${fontSize}px "Open Sans", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        const label = (node.label || "").replace(/_/g, " ");
        const tw = ctx.measureText(label).width;
        const pad = 5 / globalScale;
        const ly = y - 5 - 10 / globalScale; // 10px above center dot

        // Background pill
        const bgColor = isDark
          ? "rgba(26,26,26,0.92)"
          : "rgba(255,255,255,0.94)";
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        const rr = (fontSize + pad * 2) / 2;
        roundRect(
          ctx,
          x - tw / 2 - pad * 2,
          ly - fontSize - pad,
          tw + pad * 4,
          fontSize + pad * 2,
          rr,
        );
        ctx.fill();

        // Subtle border on pill
        ctx.strokeStyle = color + "30";
        ctx.lineWidth = 0.5 / globalScale;
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.fillText(label, x, ly);
      } else {
        // File node — tiny dot + small label below
        const r = 3;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = isDark
          ? "rgba(26,26,26,0.6)"
          : "rgba(255,255,255,0.8)";
        ctx.lineWidth = 0.8 / globalScale;
        ctx.stroke();

        // Label below node — always visible at any zoom level
        const fontSize = Math.min(Math.max(9 / globalScale, 2), 10);
        ctx.font = `400 ${fontSize}px "Open Sans", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const label = node.label || "";
        const tw = ctx.measureText(label).width;
        const pad = 2 / globalScale;
        const ly = y + r + 2 / globalScale;

        const bgColor = isDark
          ? "rgba(26,26,26,0.78)"
          : "rgba(255,255,255,0.84)";
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        roundRect(
          ctx,
          x - tw / 2 - pad * 2,
          ly - pad,
          tw + pad * 4,
          fontSize + pad * 2,
          (fontSize + pad * 2) / 2,
        );
        ctx.fill();

        ctx.fillStyle = isDark ? "#c4c4c4" : "#666666";
        ctx.fillText(label, x, ly);
      }

      ctx.globalAlpha = 1;
    },
    [isDark, matchesSearch],
  );

  const linkColor = useCallback(() => {
    return isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
  }, [isDark]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    if (graphRef.current) {
      const currentZoom = graphRef.current.zoom();
      graphRef.current.zoom(currentZoom * 1.4, 300);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (graphRef.current) {
      const currentZoom = graphRef.current.zoom();
      graphRef.current.zoom(currentZoom / 1.4, 300);
    }
  }, []);

  const handleZoomFit = useCallback(() => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400, 60);
    }
  }, []);

  const handleCenterOnClusters = useCallback(() => {
    if (graphRef.current) {
      // Center view without changing zoom
      graphRef.current.centerAt(0, 0, 400);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-bg-main relative overflow-hidden"
    >
      {graphData.nodes.length > 0 && (
        <>
          <ForceGraph2D
            ref={graphRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeCanvasObject={nodeCanvasObject}
            nodeCanvasObjectMode={() => "replace"}
            nodeLabel=""
            nodePointerAreaPaint={(node: any, color, ctx) => {
              const r = node.type === "cluster" ? 10 : 5;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={linkColor}
            linkWidth={1.5}
            linkDirectionalParticles={0}
            onNodeClick={(node: any) => {
              onNodeClick(node as GraphNode);
            }}
            onNodeDragEnd={handleNodeDragEnd}
            onEngineStop={handleEngineStop}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.4}
            cooldownTime={4000}
            warmupTicks={100}
            enableZoomInteraction={true}
            enablePanInteraction={true}
            enableNodeDrag={true}
            backgroundColor="rgba(0,0,0,0)"
          />

          {/* Zoom Controls */}
          <div
            className="absolute top-4 right-4 flex flex-col gap-1 p-1.5 rounded-xl shadow-lg"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--bg-border)",
            }}
          >
            <button
              onClick={handleZoomIn}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-dark cursor-pointer border-none bg-transparent transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={handleZoomOut}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-dark cursor-pointer border-none bg-transparent transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <div
              className="h-px mx-2 my-0.5"
              style={{ background: "var(--bg-border)" }}
            />
            <button
              onClick={handleZoomFit}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-dark cursor-pointer border-none bg-transparent transition-colors"
              title="Fit to screen"
            >
              <Maximize2 size={18} />
            </button>
            <button
              onClick={handleCenterOnClusters}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-dark cursor-pointer border-none bg-transparent transition-colors"
              title="Center view"
            >
              <Crosshair size={18} />
            </button>
          </div>
        </>
      )}
      {(!data || graphData.nodes.length === 0) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-text-tertiary text-sm gap-3">
          <div className="w-16 h-16 rounded-2xl bg-bg-dark flex items-center justify-center mb-2">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-text-tertiary"
            >
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </div>
          <p className="font-medium text-text-secondary">
            No files yet
          </p>
          <p className="text-xs text-center max-w-xs leading-relaxed">
            Drop files into the watched folder to get started.
            {rootFolder ? (
              <>
                <br />
                <span className="font-mono">{rootFolder}</span>
              </>
            ) : null}
            <br />
            Supported: PDF, TXT, MD, DOCX, CSV, RST
          </p>
        </div>
      )}
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
