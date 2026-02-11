import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import * as d3Force from "d3-force";
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
        val: 20 + c.file_count * 5,
        file_count: c.file_count,
        description: c.description,
      })),
      ...data.files.map((f) => ({
        id: `file-${f.file_id}`,
        type: "file" as const,
        label: f.label,
        clusterId: f.cluster_id,
        val: 6,
        file_id: f.file_id,
        filename: f.filename,
        summary: f.summary,
        current_path: f.current_path,
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
    }
  }, [dataKey, graphData.nodes.length]);

  const handleEngineStop = useCallback(() => {
    if (!hasZoomedToFit.current && graphRef.current) {
      graphRef.current.zoomToFit(400, 80);
      hasZoomedToFit.current = true;
    }
  }, []);

  // Configure d3 forces for better spacing
  useEffect(() => {
    if (!graphRef.current) return;
    const fg = graphRef.current;
    // Stronger repulsion between all nodes
    fg.d3Force(
      "charge",
      d3Force.forceManyBody().strength(-200).distanceMax(400),
    );
    // Longer link distance so files spread out from cluster center
    fg.d3Force(
      "link",
      d3Force
        .forceLink()
        .id((d: any) => d.id)
        .distance(80)
        .strength(0.6),
    );
    // Keep clusters away from each other
    fg.d3Force(
      "collide",
      d3Force
        .forceCollide()
        .radius((d: any) => (d.type === "cluster" ? 40 : 15))
        .strength(0.8),
    );
    fg.d3ReheatSimulation();
  }, [graphData]);

  // Pin node position after drag so it stays put
  const handleNodeDragEnd = useCallback((node: any) => {
    node.fx = node.x;
    node.fy = node.y;
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

  return (
    <div ref={containerRef} className="w-full h-full bg-bg-main">
      {graphData.nodes.length > 0 && (
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
          d3VelocityDecay={0.3}
          cooldownTime={3000}
          warmupTicks={50}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          enableNodeDrag={true}
          backgroundColor="rgba(0,0,0,0)"
        />
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
