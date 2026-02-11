/* ─── Force-Directed Graph View ─── */
import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import {
  GraphData,
  GraphNode,
  SEFSFile,
  getClusterColor,
  getFileIcon,
} from "../types";
import { FolderOpen } from "lucide-react";

interface Props {
  data: GraphData | null;
  onNodeClick: (node: GraphNode) => void;
  searchQuery: string;
}

export function GraphView({ data, onNodeClick, searchQuery }: Props) {
  const graphRef = useRef<ForceGraphMethods>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Track dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setDimensions({ width: el.clientWidth, height: el.clientHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Highlight matching nodes
  const highlightSet = useMemo(() => {
    if (!searchQuery || !data) return new Set<string>();
    return new Set(
      data.nodes
        .filter((n) =>
          n.label.toLowerCase().includes(searchQuery.toLowerCase()),
        )
        .map((n) => n.id),
    );
  }, [searchQuery, data]);

  // Graph data with fixed positions derived from UMAP
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: data.nodes.map((n) => ({
        ...n,
        fx: n.type === "cluster" ? n.x : undefined,
        fy: n.type === "cluster" ? n.y : undefined,
      })),
      links: data.links.map((l) => ({ ...l })),
    };
  }, [data]);

  // Custom node rendering
  const drawNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHighlighted =
        highlightSet.size === 0 || highlightSet.has(node.id);
      const alpha = isHighlighted ? 1 : 0.15;
      const color = getClusterColor(node.cluster_id ?? 0);
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      ctx.globalAlpha = alpha;

      if (node.type === "cluster") {
        // Cluster node: large translucent circle with glow
        const radius = 24 + (node.file_count || 0) * 2;

        // Glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.5);
        gradient.addColorStop(0, color + "30");
        gradient.addColorStop(0.7, color + "10");
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.5, 0, 2 * Math.PI);
        ctx.fill();

        // Circle
        ctx.fillStyle = color + "20";
        ctx.strokeStyle = color + "60";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // Label
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.min(12, 10 + radius / 10)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.label, x, y);
      } else {
        // File node
        const baseRadius =
          5 + Math.min(Math.log(node.size_bytes || 1000) / 3, 4);
        const radius = baseRadius;

        // Outer glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.5);
        gradient.addColorStop(0, color + "25");
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.5, 0, 2 * Math.PI);
        ctx.fill();

        // Node circle
        ctx.fillStyle = color + "cc";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // Inner bright spot
        ctx.fillStyle = "#ffffff40";
        ctx.beginPath();
        ctx.arc(
          x - radius * 0.2,
          y - radius * 0.2,
          radius * 0.4,
          0,
          2 * Math.PI,
        );
        ctx.fill();

        // Label (show at zoom)
        if (globalScale > 1.2 || highlightSet.has(node.id)) {
          ctx.fillStyle = "var(--text-primary)";
          ctx.font = `${Math.max(10, 11 / globalScale)}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "#e8e8f0";
          const label =
            node.label.length > 20 ? node.label.slice(0, 18) + "…" : node.label;
          ctx.fillText(label, x, y + radius + 3);
        }
      }

      ctx.globalAlpha = 1;
    },
    [highlightSet],
  );

  // Custom link rendering
  const drawLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const source = link.source;
    const target = link.target;
    if (!source?.x || !target?.x) return;

    ctx.strokeStyle =
      link.value > 0.7
        ? "rgba(99, 102, 241, 0.15)"
        : "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = link.value > 0.7 ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "var(--bg-primary)" }}
    >
      {graphData.nodes.length > 0 && (
        <ForceGraph2D
          ref={graphRef as any}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeCanvasObject={drawNode}
          linkCanvasObject={drawLink}
          onNodeClick={(node: any) => onNodeClick(node as GraphNode)}
          onNodeDragEnd={(node: any) => {
            node.fx = node.x;
            node.fy = node.y;
          }}
          nodeRelSize={6}
          linkDirectionalParticles={1}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={() => "rgba(99, 102, 241, 0.4)"}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          cooldownTime={3000}
          enableNodeDrag={true}
          backgroundColor="transparent"
          onBackgroundClick={() => onNodeClick(null as any)}
        />
      )}
      {(!data || data.nodes.length === 0) && <EmptyState />}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--text-muted)",
        gap: 12,
      }}
    >
      <FolderOpen size={48} strokeWidth={1} />
      <span style={{ fontSize: 16, fontWeight: 500 }}>No files detected</span>
      <span style={{ fontSize: 13 }}>
        Add PDF, TXT, MD, DOCX, or CSV files to your root folder
      </span>
    </div>
  );
}
