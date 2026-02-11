import { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import { Delaunay } from "d3-delaunay";
import {
  GraphData,
  GraphNode,
  SEFSFile,
  getClusterColor,
  getFileIcon,
} from "../types";

interface Props {
  data: GraphData | null;
  onNodeClick: (node: GraphNode) => void;
  searchQuery: string;
}

interface PositionedFile {
  x: number;
  y: number;
  file: SEFSFile;
}

export function SpatialView({ data, onNodeClick, searchQuery }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    file: SEFSFile;
  } | null>(null);
  const [isDark, setIsDark] = useState(
    document.documentElement.classList.contains("dark"),
  );

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

  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const svg = d3.select(svgRef.current);

    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const bg = isDark ? "#1a1a1a" : "#f5f4ef";
    const textColor = isDark ? "#d4d4d4" : "#444444";
    const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

    // Single container group for zoom/pan
    const container_g = svg.append("g").attr("class", "zoom-container");

    // Position files in cluster groups
    const clusters = data.clusters;
    const cols = Math.ceil(Math.sqrt(clusters.length));
    const rows = Math.ceil(clusters.length / cols);
    const cellW = width / cols;
    const cellH = height / rows;

    const positioned: PositionedFile[] = [];

    clusters.forEach((cluster, ci) => {
      const col = ci % cols;
      const row = Math.floor(ci / cols);
      const cx = col * cellW + cellW / 2;
      const cy = row * cellH + cellH / 2;

      const clusterFiles = data.files.filter(
        (f) => f.cluster_id === cluster.id,
      );
      const angleStep = (2 * Math.PI) / Math.max(clusterFiles.length, 1);
      const radius = Math.min(cellW, cellH) * 0.3;

      clusterFiles.forEach((file, fi) => {
        const angle = angleStep * fi - Math.PI / 2;
        const r = radius * (0.4 + 0.6 * Math.random());
        positioned.push({
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
          file,
        });
      });
    });

    // Voronoi cells
    if (positioned.length > 2) {
      const delaunay = Delaunay.from(
        positioned,
        (d) => d.x,
        (d) => d.y,
      );
      const voronoi = delaunay.voronoi([0, 0, width, height]);

      const voronoiGroup = container_g.append("g").attr("class", "voronoi");

      positioned.forEach((p, i) => {
        const color = getClusterColor(p.file.cluster_id);
        const cellPath = voronoi.renderCell(i);
        voronoiGroup
          .append("path")
          .attr("d", cellPath)
          .attr("fill", color)
          .attr("fill-opacity", 0.05)
          .attr("stroke", borderColor)
          .attr("stroke-width", 1);
      });
    }

    // Cluster labels
    const clusterLabelGroup = container_g
      .append("g")
      .attr("class", "cluster-labels");
    clusters.forEach((cluster, ci) => {
      const col = ci % cols;
      const row = Math.floor(ci / cols);
      const cx = col * cellW + cellW / 2;
      const cy = row * cellH + 28;

      const label = cluster.name.replace(/_/g, " ");

      // Background rect
      const tempText = clusterLabelGroup
        .append("text")
        .attr("font-size", "14px")
        .attr("font-weight", "600")
        .attr("font-family", "Open Sans, sans-serif")
        .text(label);
      const bbox = (tempText.node() as SVGTextElement).getBBox();
      tempText.remove();

      const padX = 12;
      const padY = 6;
      clusterLabelGroup
        .append("rect")
        .attr("x", cx - bbox.width / 2 - padX)
        .attr("y", cy - bbox.height / 2 - padY)
        .attr("width", bbox.width + padX * 2)
        .attr("height", bbox.height + padY * 2)
        .attr("rx", 8)
        .attr("fill", bg)
        .attr("fill-opacity", 0.92)
        .attr("stroke", getClusterColor(cluster.id))
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.35);

      clusterLabelGroup
        .append("text")
        .attr("x", cx)
        .attr("y", cy + 1)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "14px")
        .attr("font-weight", "600")
        .attr("font-family", "Open Sans, sans-serif")
        .attr("fill", getClusterColor(cluster.id))
        .text(label);
    });

    // File nodes
    const nodesGroup = container_g.append("g").attr("class", "nodes");
    const matchesSearch = (label: string) => {
      if (!searchQuery) return true;
      return label.toLowerCase().includes(searchQuery.toLowerCase());
    };

    positioned.forEach((p) => {
      const color = getClusterColor(p.file.cluster_id);
      const matches = matchesSearch(p.file.filename);
      const opacity = matches ? 1 : 0.15;

      const g = nodesGroup
        .append("g")
        .attr("transform", `translate(${p.x},${p.y})`)
        .attr("opacity", opacity)
        .style("cursor", "pointer")
        .on("click", () => onNodeClick(p.file as any))
        .on("mouseenter", (event: MouseEvent) => {
          setTooltip({
            x: event.clientX,
            y: event.clientY,
            file: p.file,
          });
        })
        .on("mouseleave", () => setTooltip(null));

      // Circle
      g.append("circle")
        .attr("r", 5)
        .attr("fill", color)
        .attr("stroke", isDark ? "#1a1a1a" : "#ffffff")
        .attr("stroke-width", 1.5);

      // Label with background
      const label = p.file.filename;
      const fontSize = 10;

      const tempText = g
        .append("text")
        .attr("font-size", `${fontSize}px`)
        .attr("font-family", "Open Sans, sans-serif")
        .text(label);
      const textBBox = (tempText.node() as SVGTextElement).getBBox();
      tempText.remove();

      const lPadX = 5;
      const lPadY = 3;
      g.append("rect")
        .attr("x", -textBBox.width / 2 - lPadX)
        .attr("y", 10 - lPadY)
        .attr("width", textBBox.width + lPadX * 2)
        .attr("height", textBBox.height + lPadY * 2)
        .attr("rx", 4)
        .attr("fill", bg)
        .attr("fill-opacity", 0.88);

      g.append("text")
        .attr("y", 10 + fontSize)
        .attr("text-anchor", "middle")
        .attr("font-size", `${fontSize}px`)
        .attr("font-family", "Open Sans, sans-serif")
        .attr("fill", textColor)
        .text(label);
    });

    // Zoom — only transforms the container group
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 8])
      .on("zoom", (event) => {
        container_g.attr("transform", event.transform.toString());
      });

    svg.call(zoomBehavior);

    // Initial fit
    svg.call(zoomBehavior.transform, d3.zoomIdentity);
  }, [data, isDark, searchQuery, onNodeClick]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-bg-main">
      <svg ref={svgRef} className="w-full h-full" />

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-bg-card border border-bg-border rounded-lg shadow-md px-3 py-2 text-xs max-w-xs"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
          }}
        >
          <div className="font-semibold text-text-primary">
            {tooltip.file.filename}
          </div>
          <div className="text-text-tertiary mt-0.5">
            {getFileIcon(tooltip.file.file_type || "")} file
          </div>
          {tooltip.file.summary && (
            <div className="text-text-secondary mt-1 leading-relaxed">
              {tooltip.file.summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
