import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, ChevronUp, ChevronDown } from "lucide-react";
import { getMetrics, MetricsSummary } from "../api";

export function MetricsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (expanded) {
      getMetrics()
        .then(setMetrics)
        .catch(() => {});
      intervalRef.current = setInterval(() => {
        getMetrics()
          .then(setMetrics)
          .catch(() => {});
      }, 10_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expanded]);

  return (
    <div className="absolute bottom-14 right-4 z-20">
      <div
        className="bg-bg-card border border-bg-border rounded-lg shadow-md overflow-hidden"
        style={{ minWidth: expanded ? 240 : "auto" }}
      >
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-text-secondary cursor-pointer bg-transparent border-none hover:text-text-primary transition-colors"
        >
          <Activity size={12} className="text-accent" />
          Performance
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>

        <AnimatePresence>
          {expanded && metrics && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="border-t border-bg-border"
            >
              <div className="px-3 py-2.5 space-y-2">
                <MetricRow
                  label="Extraction"
                  value={`${metrics.avg_extraction_ms}ms`}
                  count={metrics.extraction_count}
                  color="var(--status-success)"
                />
                <MetricRow
                  label="Embedding"
                  value={`${metrics.avg_embedding_ms}ms`}
                  count={metrics.embedding_count}
                  color="var(--accent)"
                />
                <MetricRow
                  label="Clustering"
                  value={`${metrics.last_clustering_ms}ms`}
                  count={metrics.clustering_count}
                  color="var(--status-warning)"
                />
                <div className="pt-1 border-t border-bg-border">
                  <div className="flex justify-between text-[10px] text-text-tertiary">
                    <span>Total processed</span>
                    <span className="font-mono">
                      {metrics.total_files_processed}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  count,
  color,
}: {
  label: string;
  value: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
        />
        <span className="text-[11px] text-text-secondary">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-text-primary">{value}</span>
        <span className="text-[9px] text-text-tertiary">({count})</span>
      </div>
    </div>
  );
}
