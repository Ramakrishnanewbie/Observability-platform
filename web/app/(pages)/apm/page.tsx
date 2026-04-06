"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { observoApi } from "@/lib/observo-api";
import { useDatasource } from "@/hooks/use-datasource";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  Zap, TrendingUp, TrendingDown, AlertCircle, Activity,
  Clock, CheckCircle2, XCircle, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";

const TIME_OPTIONS = [
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "4h", value: 240 },
  { label: "24h", value: 1440 },
];

const TT_STYLE: React.CSSProperties = {
  fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))",
  backgroundColor: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
  boxShadow: "0 4px 16px rgba(0,0,0,0.2)", padding: "8px 12px",
};

function latencyColor(ms: number) {
  if (ms < 50) return "#22c55e";
  if (ms < 200) return "#3b82f6";
  if (ms < 500) return "#eab308";
  return "#ef4444";
}

function errorRateColor(rate: number) {
  if (rate < 1) return "#22c55e";
  if (rate < 5) return "#eab308";
  return "#ef4444";
}

function formatMs(ms: number) {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ─── Service Row ───
function ServiceRow({ svc, selected, onSelect }: { svc: any; selected: boolean; onSelect: () => void }) {
  const errColor = errorRateColor(svc.error_rate);
  const latColor = latencyColor(svc.p95_ms);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "grid gap-4 px-4 py-3 cursor-pointer transition-all border-b border-border/40 hover:bg-muted/30",
        selected && "bg-primary/5 border-l-2 border-l-primary"
      )}
      style={{ gridTemplateColumns: "1fr 80px 80px 80px 80px 80px 80px 60px" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: latColor }} />
        <span className="font-mono text-[12px] font-semibold truncate">{svc.service}</span>
      </div>
      <span className="text-[11px] tabular-nums text-right">{svc.requests.toLocaleString()}</span>
      <span className="text-[11px] tabular-nums text-right" style={{ color: errColor }}>
        {svc.error_rate.toFixed(1)}%
      </span>
      <span className="text-[11px] tabular-nums text-right">{formatMs(svc.avg_latency_ms)}</span>
      <span className="text-[11px] tabular-nums text-right">{formatMs(svc.p50_ms)}</span>
      <span className="text-[11px] tabular-nums text-right" style={{ color: latColor }}>{formatMs(svc.p95_ms)}</span>
      <span className="text-[11px] tabular-nums text-right">{formatMs(svc.p99_ms)}</span>
      <span className="text-[11px] tabular-nums text-right text-muted-foreground">{svc.throughput_rpm.toFixed(1)}</span>
    </div>
  );
}

// ─── Metric KPI ───
function KPI({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-2xl font-extrabold tabular-nums" style={{ color }}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

export default function APMPage() {
  const { selectedHost } = useDatasource();
  const [services, setServices] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState(60);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<string>("requests");
  const [sortAsc, setSortAsc] = useState(false);

  const fetchServices = useCallback(async () => {
    try {
      const data = await observoApi.getAPMServices(timeRange);
      // Filter by host if a datasource is selected
      const filtered = selectedHost
        ? (data || []).filter((s: any) => !s.host || s.host === selectedHost || s.host?.startsWith(selectedHost))
        : (data || []);
      setServices(filtered);
      if (!selected && filtered.length > 0) setSelected(filtered[0].service);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [timeRange, selectedHost]);

  const fetchTimeseries = useCallback(async () => {
    if (!selected) return;
    try {
      const data = await observoApi.getAPMServiceTimeseries(selected, timeRange);
      setTimeseries(data || []);
    } catch (e) {
      console.error(e);
    }
  }, [selected, timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchServices();
  }, [fetchServices]);

  useEffect(() => {
    fetchTimeseries();
    const i = setInterval(fetchTimeseries, 10000);
    return () => clearInterval(i);
  }, [fetchTimeseries]);

  useEffect(() => {
    const i = setInterval(fetchServices, 15000);
    return () => clearInterval(i);
  }, [fetchServices]);

  const sorted = useMemo(() => {
    return [...services].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortAsc ? av - bv : bv - av;
    });
  }, [services, sortKey, sortAsc]);

  const selectedSvc = useMemo(
    () => services.find(s => s.service === selected),
    [services, selected]
  );

  const tsFormatted = useMemo(() => {
    return (timeseries || []).map((p: any) => ({
      time: new Date(p.minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      requests: p.requests,
      errors: p.errors,
      avg: parseFloat(p.avg_latency_ms?.toFixed(1) || "0"),
      p95: parseFloat(p.p95_ms?.toFixed(1) || "0"),
      errorRate: p.requests > 0 ? parseFloat(((p.errors / p.requests) * 100).toFixed(2)) : 0,
    }));
  }, [timeseries]);

  // Fleet-wide KPIs
  const totalRequests = services.reduce((s, x) => s + (x.requests || 0), 0);
  const totalErrors = services.reduce((s, x) => s + (x.errors || 0), 0);
  const fleetErrorRate = totalRequests > 0 ? (totalErrors / totalRequests * 100) : 0;
  const avgP95 = services.length > 0
    ? services.reduce((s, x) => s + (x.p95_ms || 0), 0) / services.length : 0;
  const highErrServices = services.filter(s => s.error_rate > 5).length;

  function toggleSort(key: string) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortIcon({ k }: { k: string }) {
    if (sortKey !== k) return null;
    return sortAsc
      ? <ChevronUp className="h-3 w-3 inline ml-1 opacity-60" />
      : <ChevronDown className="h-3 w-3 inline ml-1 opacity-60" />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-bold tracking-tight">APM — Application Performance</h1>
            <p className="text-[11px] text-muted-foreground">
              {services.length} services · {totalRequests.toLocaleString()} requests
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
          <button onClick={() => { fetchServices(); fetchTimeseries(); }}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {/* Fleet KPIs */}
        <div className="grid grid-cols-4 gap-3">
          <KPI label="Total Requests" value={totalRequests.toLocaleString()} sub={`last ${timeRange}m`} color="#3b82f6" />
          <KPI label="Fleet Error Rate" value={`${fleetErrorRate.toFixed(2)}%`}
            sub={`${totalErrors.toLocaleString()} errors`} color={errorRateColor(fleetErrorRate)} />
          <KPI label="Avg P95 Latency" value={formatMs(avgP95)}
            sub="across all services" color={latencyColor(avgP95)} />
          <KPI label="Degraded Services" value={`${highErrServices}`}
            sub=">5% error rate" color={highErrServices > 0 ? "#ef4444" : "#22c55e"} />
        </div>

        {/* Services Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="grid gap-4 px-4 py-2 bg-muted/20 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            style={{ gridTemplateColumns: "1fr 80px 80px 80px 80px 80px 80px 60px" }}>
            <button className="text-left" onClick={() => toggleSort("service")}>Service<SortIcon k="service" /></button>
            <button className="text-right" onClick={() => toggleSort("requests")}>Requests<SortIcon k="requests" /></button>
            <button className="text-right" onClick={() => toggleSort("error_rate")}>Error %<SortIcon k="error_rate" /></button>
            <button className="text-right" onClick={() => toggleSort("avg_latency_ms")}>Avg<SortIcon k="avg_latency_ms" /></button>
            <button className="text-right" onClick={() => toggleSort("p50_ms")}>P50<SortIcon k="p50_ms" /></button>
            <button className="text-right" onClick={() => toggleSort("p95_ms")}>P95<SortIcon k="p95_ms" /></button>
            <button className="text-right" onClick={() => toggleSort("p99_ms")}>P99<SortIcon k="p99_ms" /></button>
            <button className="text-right" onClick={() => toggleSort("throughput_rpm")}>RPM<SortIcon k="throughput_rpm" /></button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground/40 text-sm">
              Loading service data...
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Zap className="h-10 w-10 text-muted-foreground/15 mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">No trace data yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Start the agent to generate APM data</p>
            </div>
          ) : (
            sorted.map(svc => (
              <ServiceRow
                key={svc.service}
                svc={svc}
                selected={selected === svc.service}
                onSelect={() => setSelected(svc.service)}
              />
            ))
          )}
        </div>

        {/* Selected Service Detail */}
        {selectedSvc && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 pt-4 pb-2 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-bold">{selectedSvc.service}</span>
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold",
                  selectedSvc.error_rate > 5 ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")}>
                  {selectedSvc.error_rate > 5 ? "Degraded" : "Healthy"}
                </span>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span>{selectedSvc.requests.toLocaleString()} requests</span>
                <span style={{ color: errorRateColor(selectedSvc.error_rate) }}>
                  {selectedSvc.error_rate.toFixed(2)}% error
                </span>
                <span style={{ color: latencyColor(selectedSvc.p95_ms) }}>
                  P95: {formatMs(selectedSvc.p95_ms)}
                </span>
              </div>
            </div>

            {tsFormatted.length > 0 ? (
              <div className="grid grid-cols-2 gap-0 divide-x divide-border">
                {/* Latency Chart */}
                <div className="p-4">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Latency Over Time (ms)
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={tsFormatted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36}
                        tickFormatter={(v) => `${v}ms`} />
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => [`${v}ms`]} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="avg" name="Avg" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="p95" name="P95" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Error Rate + Throughput */}
                <div className="p-4">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Requests &amp; Error Rate
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={tsFormatted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="left" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={30} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36}
                        tickFormatter={(v) => `${v}%`} />
                      <Tooltip contentStyle={TT_STYLE} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                      <Bar yAxisId="left" dataKey="requests" name="Requests" fill="#3b82f640" radius={[2, 2, 0, 0]} />
                      <Bar yAxisId="left" dataKey="errors" name="Errors" fill="#ef444480" radius={[2, 2, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="errorRate" name="Error %" stroke="#ef4444" strokeWidth={2} dot={false} />
                      <ReferenceLine yAxisId="right" y={5} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.4} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-10 text-muted-foreground/30 text-xs">
                No timeseries data for this service in the selected window.
              </div>
            )}

            {/* Latency distribution bar */}
            <div className="px-5 py-3 border-t border-border bg-muted/10 grid grid-cols-5 gap-3">
              {[
                { label: "Min", value: selectedSvc.min_latency_ms, color: "#22c55e" },
                { label: "Avg", value: selectedSvc.avg_latency_ms, color: "#3b82f6" },
                { label: "P50", value: selectedSvc.p50_ms, color: "#6366f1" },
                { label: "P95", value: selectedSvc.p95_ms, color: "#f59e0b" },
                { label: "P99", value: selectedSvc.p99_ms, color: "#ef4444" },
              ].map(item => (
                <div key={item.label} className="text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{item.label}</div>
                  <div className="text-[15px] font-bold tabular-nums" style={{ color: item.color }}>
                    {formatMs(item.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
