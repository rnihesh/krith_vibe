import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import * as d3Force from "d3-force";
import { ZoomIn, ZoomOut, Maximize2, Crosshair } from "lucide-react";
import { GraphData, GraphNode, getClusterColor } from "../types";

interface Props {
  data: GraphData | null;
  onNodeClick: (node: GraphNode) => void;
  searchQuery: string;
}

export function GraphView({ data, onNodeClick, searchQuery }: Props) {
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
        val: 20 + c.file_count * 5,
        file_count: c.file_count,
        description: c.description,
      })),
      ...data.files.map((f) => ({
        id: `file-${f.file_id}`,
        type: "file" as const,
        label: f.label,
        clusterId: f.cluster_id,
        cluster_id: f.cluster_id,
        val: 6,
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

    const links = data.files.map((f) => ({
      source: `file-${f.file_id}`,
      target: `cluster-${f.cluster_id}`,
    }));

    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // Zoom to fit once after initial layout settles
  useEffect(() => {
    if (graphData.nodes.length > 0 && dataKey !== prevDataKey.current) {
      prevDataKey.current = dataKey;
      hasZoomedToFit.current = false;
      // Zoom to fit after layout has had time to settle
      const timer = setTimeout(() => {
        if (!hasZoomedToFit.current && graphRef.current) {
          graphRef.current.zoomToFit(400, 80);
          hasZoomedToFit.current = true;
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [dataKey, graphData.nodes.length]);

  const handleEngineStop = useCallback(() => {
    // Engine won't stop with Infinity cooldown, but keep as safety
    if (!hasZoomedToFit.current && graphRef.current) {
      graphRef.current.zoomToFit(400, 80);
      hasZoomedToFit.current = true;
    }
  }, []);

  // Configure d3 forces for better spacing
  useEffect(() => {
    if (!graphRef.current) return;
    const fg = graphRef.current;

    // Strong center force to keep everything anchored in the middle
    fg.d3Force("center", d3Force.forceCenter(0, 0).strength(0.1));

    // Moderate repulsion - not too strong, not too weak
    fg.d3Force(
      "charge",
      d3Force.forceManyBody().strength(-120).distanceMax(250),
    );

    // Link force - keeps files connected to clusters
    fg.d3Force(
      "link",
      d3Force
        .forceLink()
        .id((d: any) => d.id)
        .distance(60)
        .strength(0.7),
    );

    // Collision - prevent overlap
    fg.d3Force(
      "collide",
      d3Force
        .forceCollide()
        .radius((d: any) => (d.type === "cluster" ? 35 : 12))
        .strength(0.7),
    );

    fg.d3ReheatSimulation();
  }, [graphData]);

  // Pin node position after drag temporarily, then unpin after settle
  const handleNodeDragEnd = useCallback((node: any) => {
    // Temporarily pin so it doesn't fly away
    node.fx = node.x;
    node.fy = node.y;
    // Unpin after 3 seconds so it rejoins the simulation
    setTimeout(() => {
      node.fx = undefined;
      node.fy = undefined;
    }, 3000);
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
        const r = Math.sqrt(node.val || 20) * 2;

        // Outer glow
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = color + "08";
        ctx.fill();

        // Circle fill
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color + "12";
        ctx.fill();
        ctx.strokeStyle = color + "35";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label — positioned above the cluster, always readable
        const fontSize = Math.min(Math.max(13 / globalScale, 4), 16);
        ctx.font = `700 ${fontSize}px "Open Sans", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        const label = (node.label || "").replace(/_/g, " ");
        const tw = ctx.measureText(label).width;
        const pad = 5 / globalScale;
        const ly = y - r - 6 / globalScale; // above the cluster

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
        // File node
        const r = 5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = isDark
          ? "rgba(26,26,26,0.8)"
          : "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();

        // Label below node
        const fontSize = Math.min(Math.max(10 / globalScale, 2.5), 11);
        ctx.font = `400 ${fontSize}px "Open Sans", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const label = node.label || "";
        const tw = ctx.measureText(label).width;
        const pad = 3 / globalScale;
        const ly = y + r + 3 / globalScale;

        const bgColor = isDark
          ? "rgba(26,26,26,0.82)"
          : "rgba(255,255,255,0.88)";
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        const rr2 = (fontSize + pad * 2) / 2;
        roundRect(
          ctx,
          x - tw / 2 - pad * 2,
          ly - pad,
          tw + pad * 4,
          fontSize + pad * 2,
          rr2,
        );
        ctx.fill();

        ctx.fillStyle = isDark ? "#d4d4d4" : "#555555";
        ctx.fillText(label, x, ly);
      }

      ctx.globalAlpha = 1;
    },
    [isDark, matchesSearch],
  );

  const linkColor = useCallback(() => {
    return isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
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
    <div ref={containerRef} className="w-full h-full bg-bg-main relative">
      {graphData.nodes.length > 0 && (
        <>
          <ForceGraph2D
            ref={graphRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeCanvasObject={nodeCanvasObject}
            nodePointerAreaPaint={(node: any, color, ctx) => {
              const r =
                node.type === "cluster" ? Math.sqrt(node.val || 20) * 1.8 : 5;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, r + 5, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={linkColor}
            linkWidth={0.8}
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
        <div className="absolute inset-0 flex items-center justify-center text-text-tertiary text-sm">
          No files to display. Drop files into the watched folder.
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
