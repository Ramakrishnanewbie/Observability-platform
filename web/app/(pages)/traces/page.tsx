"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn, formatDuration } from "@/lib/utils";
import { Network, ArrowLeft } from "lucide-react";

const SVC_COLORS = ["#3B82F6", "#A855F7", "#22C55E", "#F97316", "#EF4444", "#EAB308", "#06B6D4", "#EC4899", "#8B5CF6", "#14B8A6"];
function hashStr(s: string) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
function svcColor(svc: string) { return SVC_COLORS[hashStr(svc) % SVC_COLORS.length]; }

export default function TracesPage() {
  const [traces, setTraces] = useState<any[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [selService, setSelService] = useState("");
  const [selTrace, setSelTrace] = useState<string | null>(null);
  const [spans, setSpans] = useState<any[]>([]);

  const fetchTraces = useCallback(async () => {
    try {
      let params = "minutes=30&limit=50";
      if (selService) params += `&service=${selService}`;
      const [t, s] = await Promise.all([observoApi.getTraces(params), observoApi.getServices()]);
      setTraces(t || []); setServices(s || []);
    } catch (e) { console.error(e); }
  }, [selService]);

  useEffect(() => { fetchTraces(); const i = setInterval(fetchTraces, 5000); return () => clearInterval(i); }, [fetchTraces]);

  const openTrace = async (id: string) => {
    setSelTrace(id);
    try { const s = await observoApi.getTraceDetail(id); setSpans(s || []); } catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center gap-3">
        <Network className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-base font-bold tracking-tight">Traces</h1>
          <p className="text-[11px] text-muted-foreground">Distributed tracing · {(traces || []).length} traces</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {selTrace ? (
          /* ── Waterfall view ── */
          <div>
            <button onClick={() => { setSelTrace(null); setSpans([]); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/30 text-primary text-[11px] font-semibold mb-4 hover:bg-primary/5 transition-colors">
              <ArrowLeft className="h-3 w-3" /> Back to Traces
            </button>
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-bold">Trace Waterfall</h3>
                  <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{selTrace}</p>
                </div>
                <div className="flex gap-6 text-right">
                  <div><p className="text-[10px] text-muted-foreground">Spans</p><p className="text-lg font-bold">{spans.length}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">Duration</p><p className="text-lg font-bold">
                    {spans.length ? `${(Math.max(...spans.map((s: any) => new Date(s.start_time).getTime() + s.duration_ms)) - Math.min(...spans.map((s: any) => new Date(s.start_time).getTime()))).toFixed(0)}ms` : "—"}
                  </p></div>
                </div>
              </div>
              {(() => {
                if (!spans.length) return null;
                const minStart = Math.min(...spans.map((s: any) => new Date(s.start_time).getTime()));
                const maxEnd = Math.max(...spans.map((s: any) => new Date(s.start_time).getTime() + s.duration_ms));
                const totalRange = maxEnd - minStart || 1;
                return (
                  <div className="flex flex-col gap-px">
                    {spans.map((s: any, i: number) => {
                      const start = new Date(s.start_time).getTime();
                      const leftPct = ((start - minStart) / totalRange) * 100;
                      const widthPct = Math.max((s.duration_ms / totalRange) * 100, 1.5);
                      const color = s.status === "error" ? "#EF4444" : svcColor(s.service);
                      return (
                        <div key={i} className="flex items-center py-1.5 border-b border-border/50">
                          <div className="w-[150px] shrink-0 pr-3">
                            <div className="text-xs font-semibold" style={{ color }}>{s.service}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{s.operation}</div>
                          </div>
                          <div className="flex-1 relative h-6 bg-muted rounded">
                            <div className="absolute h-full rounded opacity-85 flex items-center pl-2 min-w-[6px]"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color }}>
                              <span className="text-[10px] font-mono font-semibold text-white whitespace-nowrap drop-shadow">{s.duration_ms.toFixed(1)}ms</span>
                            </div>
                          </div>
                          <div className="w-[60px] shrink-0 text-right">
                            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded",
                              s.status === "error" ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")}>
                              {s.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          /* ── Trace list ── */
          <div>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <button onClick={() => setSelService("")}
                className={cn("px-3 py-1 rounded-md text-[11px] font-semibold border transition-colors",
                  selService === "" ? "bg-primary/10 text-primary border-primary/30" : "border-border text-muted-foreground")}>
                All Services
              </button>
              {(services || []).map(s => (
                <button key={s} onClick={() => setSelService(s)}
                  className={cn("px-3 py-1 rounded-md text-[11px] font-semibold border transition-colors flex items-center gap-1.5",
                    selService === s ? "bg-primary/10 text-primary border-primary/30" : "border-border text-muted-foreground")}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: svcColor(s) }} />
                  {s}
                </button>
              ))}
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {["Trace ID", "Services", "Spans", "Duration", "Status", "Time"].map(h => (
                      <th key={h} className="text-left p-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(traces || []).length === 0 ? (
                    <tr><td colSpan={6} className="p-10 text-center text-muted-foreground text-xs">No traces yet</td></tr>
                  ) : traces.map((t: any, i: number) => (
                    <tr key={i} onClick={() => openTrace(t.trace_id)}
                      className="border-b border-border/30 cursor-pointer hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-mono text-[11px] text-primary">{t.trace_id?.slice(0, 12)}…</td>
                      <td className="p-3">
                        <div className="flex gap-1 flex-wrap">
                          {(t.services || []).map((s: string) => (
                            <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${svcColor(s)}15`, color: svcColor(s) }}>{s}</span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-xs">{t.span_count}</td>
                      <td className="p-3 text-xs font-mono">{t.total_duration_ms?.toFixed(1)}ms</td>
                      <td className="p-3">
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded",
                          t.has_error ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")}>
                          {t.has_error ? "ERROR" : "OK"}
                        </span>
                      </td>
                      <td className="p-3 text-[11px] text-muted-foreground">{new Date(t.start_time).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
