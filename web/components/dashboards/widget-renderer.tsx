"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { formatBytes } from "@/lib/utils";
import type { WidgetConfig } from "@/lib/dashboard-types";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, AlertCircle, Bell,
  Server, ScrollText, Loader2, Network,
} from "lucide-react";

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
      <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--foreground))", margin: "2px 0 0" }}>{payload[0].value.toFixed(2)}%</p>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", borderRadius: 12 }}>{children}</div>;
}

// ─── KPI ───
function KPIWidget({ config }: { config: WidgetConfig }) {
  const [value, setValue] = useState<number | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const [spark, setSpark] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const color = config.color || "#3B82F6";
  const isBytes = config.metric?.includes("bytes");

  const fetchData = useCallback(async () => {
    try {
      const m = config.metric || "cpu.usage_percent";
      const [lat, ts] = await Promise.all([observoApi.getLatest(config.host), observoApi.getTimeseries(m, config.timeRange || 10, config.host)]);
      const f = (lat || []).find((x: any) => x.metric_name === m);
      setValue(f?.value ?? null);
      const d = (ts || []).map((x: any) => ({ v: x.value }));
      if (d.length > 1) setPrev(d[d.length - 2]?.v);
      setSpark(d);
    } catch {} finally { setLoading(false); }
  }, [config.metric, config.host, config.timeRange]);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, [fetchData]);

  const chg = value !== null && prev !== null && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null;
  const trend = chg !== null ? (chg > 0.5 ? "up" : chg < -0.5 ? "down" : "flat") : "flat";

  return (
    <Frame>
      {/* Sparkline bg */}
      {spark.length > 2 && (
        <div style={{ position: "absolute", inset: 0, opacity: 0.1, pointerEvents: "none" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs><linearGradient id={`kpi-${config.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.6} /><stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient></defs>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#kpi-${config.id})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Accent bar */}
      <div style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: "0 3px 3px 0", background: color, zIndex: 2 }} />

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "14px 18px 14px 22px" }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, lineHeight: 1 }}>
          {config.title}
        </p>
        {loading ? (
          <Loader2 style={{ width: 16, height: 16, color: "hsl(var(--muted-foreground))", animation: "spin 1s linear infinite" }} />
        ) : value !== null ? (
          <>
            <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color, margin: 0 }}>
              {isBytes ? formatBytes(value) : `${value.toFixed(1)}%`}
            </p>
            {chg !== null && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8 }}>
                {trend === "up" ? <TrendingUp style={{ width: 12, height: 12, color: "#10b981" }} /> : trend === "down" ? <TrendingDown style={{ width: 12, height: 12, color: "#ef4444" }} /> : <Minus style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))" }} />}
                <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: trend === "up" ? "#10b981" : trend === "down" ? "#ef4444" : "hsl(var(--muted-foreground))" }}>
                  {chg > 0 ? "+" : ""}{chg.toFixed(1)}%
                </span>
              </div>
            )}
          </>
        ) : (
          <p style={{ fontSize: 22, fontWeight: 700, color: "hsl(var(--muted-foreground))", opacity: 0.25, margin: 0 }}>No data</p>
        )}
      </div>
    </Frame>
  );
}

// ─── Timeseries (area/line) ───
function TimeseriesWidget({ config, chartType = "area" }: { config: WidgetConfig; chartType?: "area" | "line" }) {
  const [data, setData] = useState<any[]>([]);
  const color = config.color || "#3B82F6";
  const gradId = `ts-${config.id}`;
  const isPercent = !config.metric?.includes("bytes") && !config.metric?.includes("cores") && !config.metric?.includes("count") && !config.metric?.includes("rate");

  const fetchData = useCallback(async () => {
    try {
      const ts = await observoApi.getTimeseries(config.metric || "cpu.usage_percent", config.timeRange || 10, config.host);
      setData((ts || []).map((d: any) => ({ ...d, time: new Date(d.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })));
    } catch {}
  }, [config.metric, config.host, config.timeRange]);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, [fetchData]);

  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "14px 16px" }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, lineHeight: 1 }}>
          {config.title}
        </p>
        {data.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader2 style={{ width: 16, height: 16, color: "hsl(var(--muted-foreground))", animation: "spin 1s linear infinite", opacity: 0.4 }} />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "area" ? (
                <AreaChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <defs><linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.25} /><stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} domain={isPercent ? [0, 100] : ["auto", "auto"]} tickFormatter={(v: number) => isPercent ? `${v}%` : `${v}`} />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} dot={false} activeDot={{ r: 3, fill: color }} />
                </AreaChart>
              ) : (
                <LineChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} domain={isPercent ? [0, 100] : ["auto", "auto"]} tickFormatter={(v: number) => isPercent ? `${v}%` : `${v}`} />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: color }} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Frame>
  );
}

// ─── Bar Chart ───
function BarChartWidget({ config }: { config: WidgetConfig }) {
  const [data, setData] = useState<any[]>([]);
  const color = config.color || "#3B82F6";

  const fetchData = useCallback(async () => {
    try {
      // Bar chart shows latest value per host for a given metric
      const latest = await observoApi.getLatest();
      const metric = config.metric || "cpu.usage_percent";
      const byHost = (latest || [])
        .filter((d: any) => d.metric_name === metric)
        .map((d: any) => ({ host: d.host, value: d.value }))
        .sort((a: any, b: any) => b.value - a.value)
        .slice(0, 10);
      setData(byHost);
    } catch {}
  }, [config.metric]);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, [fetchData]);
  const isPercent = !config.metric?.includes("bytes");

  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "14px 16px" }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, lineHeight: 1 }}>
          {config.title}
        </p>
        {data.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader2 style={{ width: 16, height: 16, color: "hsl(var(--muted-foreground))", animation: "spin 1s linear infinite", opacity: 0.4 }} />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} domain={isPercent ? [0, 100] : ["auto", "auto"]} tickFormatter={(v: number) => isPercent ? `${v}%` : `${v}`} />
                <YAxis type="category" dataKey="host" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(v: any) => [isPercent ? `${Number(v).toFixed(1)}%` : v, config.metric]} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {data.map((_: any, i: number) => (
                    <Cell key={i} fill={color} fillOpacity={1 - i * 0.07} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Frame>
  );
}

// ─── Trace List ───
function TraceListWidget({ config }: { config: WidgetConfig }) {
  const [traces, setTraces] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const t = await observoApi.getTraces("minutes=10&limit=20");
      setTraces(t || []);
    } catch {}
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, [fetchData]);

  const statusColor = (s: string) => s === "error" ? "#ef4444" : "#22c55e";

  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px 6px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em" }}>{config.title || "Recent Traces"}</p>
          <Network style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))", opacity: 0.3 }} />
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
          {traces.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 11, color: "hsl(var(--muted-foreground))", opacity: 0.4 }}>No traces yet</div>
          ) : traces.map((t: any, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 6, marginBottom: 2, background: "hsl(var(--muted) / 0.15)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(t.status), flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.service}</span>
              <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>{t.operation?.slice(0, 20)}</span>
              <span style={{ fontSize: 9, fontFamily: "monospace", color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>{t.duration_ms?.toFixed(0)}ms</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

// ─── Log Stream ───
function LogStreamWidget({ config }: { config: WidgetConfig }) {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const f = async () => { try { const l = await observoApi.getLogs(`limit=20${config.severity ? `&severity=${config.severity}` : ""}`); setLogs(l || []); } catch {} };
    f(); const i = setInterval(f, 5000); return () => clearInterval(i);
  }, [config.severity]);

  const sc: Record<string, string> = { fatal: "#ef4444", error: "#f97316", warn: "#eab308", info: "#3b82f6", debug: "#64748b" };

  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px 6px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em" }}>{config.title || "Log Stream"}</p>
          <ScrollText style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))", opacity: 0.3 }} />
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
          {logs.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 11, color: "hsl(var(--muted-foreground))", opacity: 0.4 }}>Waiting for logs…</div>
          ) : logs.map((l: any, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 6px", borderRadius: 4, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 3, background: `${sc[l.severity] || sc.info}18`, color: sc[l.severity] || sc.info, flexShrink: 0 }}>
                {(l.severity || "info").toUpperCase().slice(0, 3)}
              </span>
              <span style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0, fontVariantNumeric: "tabular-nums", fontSize: 10 }}>
                {new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span style={{ color: "hsl(var(--foreground))", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

// ─── Alert Status ───
function AlertStatusWidget({ config }: { config: WidgetConfig }) {
  const [firing, setFiring] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);

  useEffect(() => {
    const f = async () => { try { const [a, r] = await Promise.all([observoApi.getFiringAlerts(), observoApi.getAlertRules()]); setFiring(a || []); setRules(r || []); } catch {} };
    f(); const i = setInterval(f, 5000); return () => clearInterval(i);
  }, []);

  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em" }}>{config.title || "Alerts"}</p>
          <Bell style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))", opacity: 0.3 }} />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {firing.length > 0 ? firing.map((a: any, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderRadius: 8, background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.1)", marginBottom: 4 }}>
              <AlertCircle style={{ width: 14, height: 14, color: "#ef4444", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#ef4444", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.rule_name}</p>
                <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", margin: 0 }}>{a.host}</p>
              </div>
            </div>
          )) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(34,197,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                <Bell style={{ width: 16, height: 16, color: "#22c55e" }} />
              </div>
              <p style={{ fontSize: 12, fontWeight: 600, color: "#22c55e", margin: 0 }}>All Clear</p>
              <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", margin: "2px 0 0" }}>{rules.length} rules active</p>
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
}

// ─── Host Map ───
function HostMapWidget({ config }: { config: WidgetConfig }) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    const f = async () => {
      try {
        const [h, l] = await Promise.all([observoApi.getHosts(), observoApi.getLatest()]);
        setHosts(h || []);
        const byHost: Record<string, Record<string, number>> = {};
        (l || []).forEach((m: any) => { if (!byHost[m.host]) byHost[m.host] = {}; byHost[m.host][m.metric_name] = m.value; });
        setMetrics(byHost);
      } catch {}
    };
    f(); const i = setInterval(f, 5000); return () => clearInterval(i);
  }, []);

  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em" }}>{config.title || "Hosts"}</p>
          <Server style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))", opacity: 0.3 }} />
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignContent: "start", overflow: "auto" }}>
          {hosts.map(h => {
            const cpu = metrics[h]?.["cpu.usage_percent"];
            const c = cpu !== undefined ? (cpu > 85 ? "#ef4444" : cpu > 70 ? "#eab308" : "#22c55e") : "hsl(var(--muted-foreground))";
            return (
              <div key={h} style={{ padding: 8, borderRadius: 8, border: `1px solid ${c}25`, background: `${c}08` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
                  <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h}</span>
                </div>
                <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontFamily: "monospace", margin: 0 }}>CPU: {cpu?.toFixed(0) ?? "—"}%</p>
              </div>
            );
          })}
          {hosts.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 20, fontSize: 11, color: "hsl(var(--muted-foreground))", opacity: 0.4 }}>No hosts</div>}
        </div>
      </div>
    </Frame>
  );
}

// ─── Text ───
function TextWidget({ config }: { config: WidgetConfig }) {
  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{config.title}</p>
        {config.description && <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>{config.description}</p>}
      </div>
    </Frame>
  );
}

// ─── Metric Table ───
function MetricTableWidget({ config }: { config: WidgetConfig }) {
  const [data, setData] = useState<any[]>([]);
  useEffect(() => {
    const f = async () => { try { setData(await observoApi.getMetrics(config.host) || []); } catch {} };
    f(); const i = setInterval(f, 5000); return () => clearInterval(i);
  }, [config.host]);

  return (
    <Frame>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px 6px", flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em" }}>{config.title || "Metrics"}</p>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", fontFamily: "monospace" }}>
            <thead><tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
              {["Time", "Metric", "Value"].map(h => <th key={h} style={{ textAlign: "left", padding: "4px 6px", fontSize: 9, fontWeight: 600, color: "hsl(var(--muted-foreground))", textTransform: "uppercase" }}>{h}</th>)}
            </tr></thead>
            <tbody>{data.slice(0, 12).map((m: any, i: number) => (
              <tr key={i} style={{ borderBottom: "1px solid hsl(var(--border) / 0.3)" }}>
                <td style={{ padding: "3px 6px", color: "hsl(var(--muted-foreground))" }}>{new Date(m.timestamp).toLocaleTimeString()}</td>
                <td style={{ padding: "3px 6px", fontSize: 10 }}>{m.metric_name}</td>
                <td style={{ padding: "3px 6px" }}>{m.unit === "bytes" ? formatBytes(m.value) : `${m.value.toFixed(1)}%`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </Frame>
  );
}

// ─── Main Renderer ───
export function WidgetRenderer({ config }: { config: WidgetConfig }) {
  switch (config.type) {
    case "kpi": return <KPIWidget config={config} />;
    case "area_chart": return <TimeseriesWidget config={config} chartType="area" />;
    case "line_chart": return <TimeseriesWidget config={config} chartType="line" />;
    case "bar_chart": return <BarChartWidget config={config} />;
    case "log_stream": return <LogStreamWidget config={config} />;
    case "metric_table": return <MetricTableWidget config={config} />;
    case "trace_list": return <TraceListWidget config={config} />;
    case "alert_status": return <AlertStatusWidget config={config} />;
    case "host_map": return <HostMapWidget config={config} />;
    case "text": return <TextWidget config={config} />;
    default: return <div style={{ padding: 16, fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Unknown: {config.type}</div>;
  }
}
