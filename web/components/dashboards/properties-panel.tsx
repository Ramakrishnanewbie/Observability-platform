"use client";

import { useState, useEffect } from "react";
import type { WidgetConfig } from "@/lib/dashboard-types";
import { AVAILABLE_METRICS } from "@/lib/dashboard-types";
import { observoApi } from "@/lib/observo-api";
import { X, Palette } from "lucide-react";

const COLORS = ["#3B82F6", "#A855F7", "#22C55E", "#F97316", "#EF4444", "#EAB308", "#06B6D4", "#EC4899", "#8B5CF6", "#14B8A6"];

interface Props {
  widget: WidgetConfig;
  onUpdate: (field: string, value: any) => void;
  onClose: () => void;
}

export function PropertiesPanel({ widget, onUpdate, onClose }: Props) {
  const showMetric = ["kpi", "area_chart", "line_chart", "bar_chart"].includes(widget.type);
  const showSeverity = widget.type === "log_stream";
  const [liveMetrics, setLiveMetrics] = useState<string[]>([]);

  // Load available metric names from the API, fall back to static list
  useEffect(() => {
    observoApi.getMetricNames().then(names => {
      if (names && names.length > 0) setLiveMetrics(names);
    }).catch(() => {});
  }, []);

  return (
    <div className="w-[280px] shrink-0 border-l border-border bg-card overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <p className="text-xs font-semibold">Widget Properties</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Title</label>
          <input
            value={widget.title || ""}
            onChange={(e) => onUpdate("title", e.target.value)}
            placeholder="Widget title"
            className="w-full h-8 px-3 bg-background border border-border rounded-md text-xs outline-none focus:border-ring"
          />
        </div>

        {/* Description (for text widgets) */}
        {widget.type === "text" && (
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Content</label>
            <textarea
              value={widget.description || ""}
              onChange={(e) => onUpdate("description", e.target.value)}
              placeholder="Enter text..."
              rows={4}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-xs outline-none focus:border-ring resize-none"
            />
          </div>
        )}

        {/* Metric selector */}
        {showMetric && (
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Metric</label>
            <select
              value={widget.metric || "cpu.usage_percent"}
              onChange={(e) => onUpdate("metric", e.target.value)}
              className="w-full h-8 px-2 bg-background border border-border rounded-md text-xs outline-none"
            >
              {liveMetrics.length > 0 ? (
                liveMetrics.map(m => <option key={m} value={m}>{m}</option>)
              ) : (
                AVAILABLE_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)
              )}
            </select>
          </div>
        )}

        {/* Severity filter (logs) */}
        {showSeverity && (
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Severity Filter</label>
            <select
              value={widget.severity || ""}
              onChange={(e) => onUpdate("severity", e.target.value)}
              className="w-full h-8 px-2 bg-background border border-border rounded-md text-xs outline-none"
            >
              <option value="">All</option>
              <option value="fatal">Fatal</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
        )}

        {/* Time range */}
        {showMetric && (
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Time Range</label>
            <select
              value={widget.timeRange || 10}
              onChange={(e) => onUpdate("timeRange", parseInt(e.target.value))}
              className="w-full h-8 px-2 bg-background border border-border rounded-md text-xs outline-none"
            >
              <option value={5}>Last 5 min</option>
              <option value={10}>Last 10 min</option>
              <option value={30}>Last 30 min</option>
              <option value={60}>Last 1 hour</option>
            </select>
          </div>
        )}

        {/* Host filter */}
        <div>
          <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Host Filter</label>
          <input
            value={widget.host || ""}
            onChange={(e) => onUpdate("host", e.target.value)}
            placeholder="All hosts"
            className="w-full h-8 px-3 bg-background border border-border rounded-md text-xs font-mono outline-none focus:border-ring"
          />
        </div>

        {/* Color */}
        {(showMetric || widget.type === "kpi") && (
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <Palette className="h-3 w-3 inline mr-1" />Color
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onUpdate("color", c)}
                  className={`w-6 h-6 rounded-md border-2 transition-all ${widget.color === c ? "border-foreground scale-110" : "border-transparent hover:border-foreground/30"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Widget type (read-only) */}
        <div className="pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground">
            Type: <span className="font-mono text-foreground/60">{widget.type}</span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            ID: <span className="font-mono text-foreground/60">{widget.id.slice(0, 8)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
