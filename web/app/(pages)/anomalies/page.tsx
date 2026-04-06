"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn } from "@/lib/utils";
import { Activity, RefreshCw, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

const TIME_OPTIONS = [
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "4h", value: 240 },
  { label: "24h", value: 1440 },
];

function ZScoreBadge({ score }: { score: number }) {
  const color = score > 5 ? "text-red-400 bg-red-500/10 border-red-500/20"
    : score > 3.5 ? "text-orange-400 bg-orange-500/10 border-orange-500/20"
    : "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
  return (
    <span className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border", color)}>
      z={score.toFixed(2)}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
      severity === "critical" ? "bg-red-500/10 text-red-400 border border-red-500/20"
        : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20")}>
      {severity}
    </span>
  );
}

export default function AnomaliesPage() {
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState(60);
  const [loading, setLoading] = useState(true);

  const fetchAnomalies = useCallback(async () => {
    try {
      const data = await observoApi.getAnomalies(timeRange);
      setAnomalies(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchAnomalies();
    const i = setInterval(fetchAnomalies, 30000);
    return () => clearInterval(i);
  }, [fetchAnomalies]);

  const critical = anomalies.filter(a => a.severity === "critical");
  const warnings = anomalies.filter(a => a.severity === "warning");

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-bold tracking-tight">Anomaly Detection</h1>
            <p className="text-[11px] text-muted-foreground">
              Statistical z-score analysis · {anomalies.length} anomalies detected
              {critical.length > 0 && ` · ${critical.length} critical`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-muted/20 p-[2px]">
            {TIME_OPTIONS.map(o => (
              <button key={o.value} onClick={() => setTimeRange(o.value)}
                className={cn("px-2.5 py-[3px] rounded text-[10px] font-semibold transition-all",
                  timeRange === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/60 hover:text-muted-foreground")}>
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={fetchAnomalies}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {/* Summary banner */}
        {anomalies.length > 0 && (
          <div className={cn("rounded-xl border p-4 flex items-center gap-4",
            critical.length > 0
              ? "bg-red-500/5 border-red-500/20"
              : "bg-yellow-500/5 border-yellow-500/20")}>
            <AlertTriangle className={cn("h-5 w-5 shrink-0", critical.length > 0 ? "text-red-400" : "text-yellow-400")} />
            <div className="flex-1">
              <p className="text-[13px] font-bold">
                {critical.length} critical · {warnings.length} warnings detected
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Metrics deviating significantly from their baseline over the last {timeRange} minutes
              </p>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="grid gap-3 px-4 py-2 bg-muted/20 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            style={{ gridTemplateColumns: "1fr 140px 80px 80px 80px 80px 80px 80px 80px" }}>
            <span>Metric</span>
            <span>Host</span>
            <span className="text-right">Current</span>
            <span className="text-right">Mean</span>
            <span className="text-right">StdDev</span>
            <span className="text-right">Min</span>
            <span className="text-right">Max</span>
            <span className="text-right">Z-Score</span>
            <span className="text-right">Severity</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground/40 text-sm">
              Analyzing metrics for anomalies...
            </div>
          ) : anomalies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Activity className="h-10 w-10 text-green-500/30 mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">All metrics look normal</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                No statistical anomalies detected in the last {timeRange} minutes
              </p>
            </div>
          ) : (
            anomalies.map((a: any, i: number) => {
              const isAboveMean = a.latest > a.mean;
              const pctDiff = a.mean !== 0 ? ((a.latest - a.mean) / Math.abs(a.mean)) * 100 : 0;
              return (
                <div key={i} className={cn(
                  "grid gap-3 px-4 py-3 border-b border-border/40 hover:bg-muted/20 transition-colors text-[11px]",
                  a.severity === "critical" && "bg-red-500/3"
                )}
                  style={{ gridTemplateColumns: "1fr 140px 80px 80px 80px 80px 80px 80px 80px" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    {isAboveMean
                      ? <TrendingUp className="h-3 w-3 text-red-400 shrink-0" />
                      : <TrendingDown className="h-3 w-3 text-blue-400 shrink-0" />}
                    <span className="font-mono text-[11px] truncate">{a.metric_name}</span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground truncate">{a.host}</span>
                  <span className={cn("text-right tabular-nums font-semibold", isAboveMean ? "text-red-400" : "text-blue-400")}>
                    {a.latest?.toFixed(2)}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">{a.mean?.toFixed(2)}</span>
                  <span className="text-right tabular-nums text-muted-foreground">±{a.stddev?.toFixed(2)}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{a.min_val?.toFixed(2)}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{a.max_val?.toFixed(2)}</span>
                  <div className="flex justify-end">
                    <ZScoreBadge score={a.z_score} />
                  </div>
                  <div className="flex justify-end">
                    <SeverityBadge severity={a.severity} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Explainer */}
        <div className="bg-card border border-border rounded-xl p-4 flex gap-3">
          <Activity className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p><strong className="text-foreground">How it works:</strong> For each metric/host combination, Observo computes the mean and standard deviation over the selected window.</p>
            <p>A <strong className="text-foreground">z-score</strong> measures how many standard deviations the current value is from the mean. z≥2.5 triggers a warning, z≥3.75 triggers critical.</p>
            <p>Anomalies are sorted by z-score (most abnormal first). No manual thresholds needed — the algorithm adapts to your baseline automatically.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
