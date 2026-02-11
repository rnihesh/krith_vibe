/* ─── UMAP Spatial Map View ─── */
import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import {
  GraphData,
  GraphNode,
  SEFSFile,
  getClusterColor,
  getFileIcon,
  formatBytes,
} from "../types";

interface Props {
  data: GraphData | null;
  onNodeClick: (node: GraphNode) => void;
  searchQuery: string;
}

export function SpatialView({ data, onNodeClick, searchQuery }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

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

  const fileNodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.filter((n) => n.type === "file") as SEFSFile[];
  }, [data]);

  const clusterNodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.filter((n) => n.type === "cluster");
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || !data || fileNodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = dimensions;
    const margin = 60;

    // Scale positions
    const xExtent = d3.extent(fileNodes, (d) => d.x) as [number, number];
    const yExtent = d3.extent(fileNodes, (d) => d.y) as [number, number];

    const xScale = d3
      .scaleLinear()
      .domain([xExtent[0] - 50, xExtent[1] + 50])
      .range([margin, width - margin]);

    const yScale = d3
      .scaleLinear()
      .domain([yExtent[0] - 50, yExtent[1] + 50])
      .range([margin, height - margin]);

    // Zoom behavior
    const g = svg.append("g");
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Voronoi for cluster regions
    if (fileNodes.length >= 3) {
      try {
        const delaunay = d3.Delaunay.from(
          fileNodes,
          (d) => xScale(d.x),
          (d) => yScale(d.y),
        );
        const voronoi = delaunay.voronoi([0, 0, width, height]);

        // Draw Voronoi cells colored by cluster
        g.append("g")
          .selectAll("path")
          .data(fileNodes)
          .enter()
          .append("path")
          .attr("d", (_, i) => voronoi.renderCell(i))
          .attr("fill", (d) => getClusterColor(d.cluster_id) + "08")
          .attr("stroke", (d) => getClusterColor(d.cluster_id) + "15")
          .attr("stroke-width", 0.5);
      } catch (e) {
        // Voronoi may fail with collinear points
      }
    }

    // Draw cluster labels
    for (const cn of clusterNodes) {
      const cx = xScale(cn.x);
      const cy = yScale(cn.y);
      const color = getClusterColor(cn.cluster_id);

      // Cluster halo
      g.append("circle")
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", 50)
        .attr("fill", color + "08")
        .attr("stroke", color + "20")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4");

      g.append("text")
        .attr("x", cx)
        .attr("y", cy - 55)
        .attr("text-anchor", "middle")
        .attr("fill", color + "aa")
        .attr("font-size", 11)
        .attr("font-weight", 600)
        .attr("font-family", "Inter, sans-serif")
        .text(cn.label);
    }

    // Draw similarity connections
    const linkGroup = g.append("g");
    for (const link of data.links) {
      const sourceNode = fileNodes.find(
        (n) =>
          n.id ===
          (typeof link.source === "string"
            ? link.source
            : (link.source as any).id),
      );
      const targetNode = fileNodes.find(
        (n) =>
          n.id ===
          (typeof link.target === "string"
            ? link.target
            : (link.target as any).id),
      );
      if (sourceNode && targetNode) {
        linkGroup
          .append("line")
          .attr("x1", xScale(sourceNode.x))
          .attr("y1", yScale(sourceNode.y))
          .attr("x2", xScale(targetNode.x))
          .attr("y2", yScale(targetNode.y))
          .attr("stroke", "rgba(255,255,255,0.03)")
          .attr("stroke-width", 0.5);
      }
    }

    // Draw file nodes
    const nodeGroup = g.append("g");

    const isMatch = (n: SEFSFile) =>
      !searchQuery || n.label.toLowerCase().includes(searchQuery.toLowerCase());

    fileNodes.forEach((node, i) => {
      const cx = xScale(node.x);
      const cy = yScale(node.y);
      const color = getClusterColor(node.cluster_id);
      const matched = isMatch(node);
      const radius = 5 + Math.min(Math.log(node.size_bytes || 1000) / 4, 3);

      const nodeG = nodeGroup
        .append("g")
        .attr("transform", `translate(${cx}, ${cy})`)
        .style("cursor", "pointer")
        .style("opacity", matched ? 1 : 0.15)
        .on("click", (event) => {
          event.stopPropagation();
          onNodeClick(node);
        })
        .on("mouseenter", (event) => {
          setTooltip({ x: event.pageX, y: event.pageY, node });
        })
        .on("mouseleave", () => {
          setTooltip(null);
        });

      // Glow
      nodeG
        .append("circle")
        .attr("r", radius * 2.5)
        .attr("fill", color + "15");

      // Node
      nodeG
        .append("circle")
        .attr("r", radius)
        .attr("fill", color + "cc")
        .attr("stroke", color)
        .attr("stroke-width", 1.5);

      // Label
      nodeG
        .append("text")
        .attr("y", radius + 12)
        .attr("text-anchor", "middle")
        .attr("fill", "#8888a8")
        .attr("font-size", 9)
        .attr("font-family", "Inter, sans-serif")
        .text(
          node.label.length > 18 ? node.label.slice(0, 16) + "…" : node.label,
        );

      // File type icon
      nodeG
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", radius * 1.2)
        .text(getFileIcon(node.file_type));
    });

    // Background click to deselect
    svg.on("click", () => onNodeClick(null as any));
  }, [data, dimensions, fileNodes, clusterNodes, searchQuery, onNodeClick]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: "var(--bg-primary)",
      }}
    >
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ display: "block" }}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x + 12,
            top: tooltip.y - 10,
            padding: "8px 12px",
            background: "var(--bg-glass)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--border-color)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--text-primary)",
            pointerEvents: "none",
            zIndex: 1000,
            maxWidth: 250,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {tooltip.node.label}
          </div>
          {tooltip.node.type === "file" && (
            <>
              <div style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                {(tooltip.node as SEFSFile).file_type.toUpperCase()} ·{" "}
                {formatBytes((tooltip.node as SEFSFile).size_bytes)}
              </div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 10,
                  marginTop: 2,
                }}
              >
                {(tooltip.node as SEFSFile).summary?.slice(0, 100)}
              </div>
            </>
          )}
        </div>
      )}

      {(!data || fileNodes.length === 0) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 15,
          }}
        >
          No files to visualize
        </div>
      )}
    </div>
  );
}
