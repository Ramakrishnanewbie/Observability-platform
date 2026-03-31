"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn, formatBytes } from "@/lib/utils";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Cpu, MemoryStick, HardDrive, Activity, RefreshCw,
  TrendingUp, TrendingDown, Minus, Clock, ChevronDown,
  Loader2, Wifi, WifiOff,
} from "lucide-react";

// ─── Tooltip ───
const TT_STYLE: React.CSSProperties = {
  fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))",
  backgroundColor: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
  boxShadow: "0 4px 16px rgba(0,0,0,0.2)", padding: "8px 12px", lineHeight: 1.6,
};

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE}>
      <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.stroke || p.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 700 }}>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}%</span>
        </div>
      ))}
    </div>
  );
}

// ─── KPI Card (with sparkline) ───
function KPICard({ label, value, prevValue, unit, icon: Icon, color, sparkData }: {
  label: string; value: number | null; prevValue?: number | null; unit: string;
  icon: any; color: string; sparkData?: any[];
}) {
  const change = value !== null && prevValue != null && prevValue !== 0
    ? ((value - prevValue) / Math.abs(prevValue)) * 100 : null;
  const trend = change !== null ? (change > 0.5 ? "up" : change < -0.5 ? "down" : "flat") : null;
  const isBytes = unit === "bytes";
  const displayValue = value !== null && value !== undefined
    ? isBytes ? formatBytes(value) : `${value.toFixed(1)}%`
    : null;

  return (
    <div className="relative bg-card border border-border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
      {/* Sparkline background */}
      {sparkData && sparkData.length > 3 && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", pointerEvents: "none" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`kpi-bg-${label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} strokeOpacity={0.4}
                fill={`url(#kpi-bg-${label.replace(/\s/g, "")})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Accent bar */}
      <div style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: "0 3px 3px 0", background: color }} />

      {/* Content */}
      <div className="relative z-[1] p-4 pl-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}12` }}>
            <Icon className="h-3.5 w-3.5" style={{ color }} />
          </div>
        </div>

        {displayValue !== null ? (
          <>
            <p className="text-[28px] font-extrabold tracking-tight leading-none" style={{ color }}>
              {displayValue}
            </p>
            {trend && change !== null && (
              <div className="flex items-center gap-1.5 mt-2">
                {trend === "up" ? <TrendingUp className="h-3 w-3 text-emerald-500" /> : trend === "down" ? <TrendingDown className="h-3 w-3 text-red-400" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                <span className={cn("text-[11px] font-semibold tabular-nums", trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-400" : "text-muted-foreground")}>
                  {change > 0 ? "+" : ""}{change.toFixed(1)}%
                </span>
                <span className="text-[10px] text-muted-foreground/50">vs prev</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 mt-1">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/30" />
            <span className="text-sm text-muted-foreground/30">Waiting…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Metric Chart (polished) ───
function MetricChart({ title, data, color, secondaryData, secondaryColor, secondaryLabel, height = 220 }: {
  title: string; data: any[]; color: string; height?: number;
  secondaryData?: any[]; secondaryColor?: string; secondaryLabel?: string;
}) {
  const formatted = useMemo(() => {
    const primary = data.map((d: any) => ({
      time: new Date(d.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      value: d.value,
    }));
    return primary;
  }, [data]);

  const gradId = `grad-${color.replace("#", "")}`;
  const n = formatted.length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
        {n > 0 && (
          <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono">{n} points</span>
        )}
      </div>
      <div className="px-2 pb-3">
        {formatted.length === 0 ? (
          <div style={{ height }} className="flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/20" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={formatted} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="50%" stopColor={color} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid horizontal vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.3} />
              <XAxis
                dataKey="time"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                tickLine={false} axisLine={false}
                interval={n > 15 ? Math.ceil(n / 10) - 1 : 0}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                tickLine={false} axisLine={false}
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                width={36}
              />
              <Tooltip content={<ChartTip />} />
              <Area
                type="monotone" dataKey="value"
                stroke={color} strokeWidth={2}
                fill={`url(#${gradId})`}
                activeDot={{ r: 4, strokeWidth: 0, fill: color }}
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Time Range Selector ───
function TimeRangeSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = [
    { label: "5m", value: 5 },
    { label: "10m", value: 10 },
    { label: "30m", value: 30 },
    { label: "1h", value: 60 },
  ];
  return (
    <div className="flex items-center rounded-md border border-border bg-muted/20 p-[2px]">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("px-2.5 py-[3px] rounded text-[10px] font-semibold transition-all",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/60 hover:text-muted-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Page ───
export default function DashboardPage() {
  const [cpuData, setCpu] = useState<any[]>([]);
  const [memData, setMem] = useState<any[]>([]);
  const [diskData, setDisk] = useState<any[]>([]);
  const [memBytesData, setMemBytes] = useState<any[]>([]);
  const [latest, setLatest] = useState<Record<string, any>>({});
  const [prevLatest, setPrevLatest] = useState<Record<string, any>>({});
  const [hosts, setHosts] = useState<string[]>([]);
  const [selectedHost, setSelectedHost] = useState("");
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState(10);

  const fetchData = useCallback(async () => {
    try {
      const h = selectedHost || undefined;
      const [c, m, d, mb, l, hList] = await Promise.all([
        observoApi.getTimeseries("cpu.usage_percent", timeRange, h),
        observoApi.getTimeseries("memory.usage_percent", timeRange, h),
        observoApi.getTimeseries("disk.usage_percent", timeRange, h),
        observoApi.getTimeseries("memory.used_bytes", timeRange, h),
        observoApi.getLatest(h),
        observoApi.getHosts().catch(() => []),
      ]);
      setCpu(c || []); setMem(m || []); setDisk(d || []); setMemBytes(mb || []);
      setHosts(hList || []);

      // Track previous for trend
      setPrevLatest(latest);
      const map: Record<string, any> = {};
      if (l) l.forEach((m: any) => { map[m.metric_name] = m; });
      setLatest(map);
      setConnected(true);
      setLastUpdate(new Date());
    } catch { setConnected(false); }
  }, [selectedHost, timeRange]);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 5000);
    return () => clearInterval(i);
  }, [fetchData]);

  // Build sparkline data for KPIs
  const cpuSpark = useMemo(() => cpuData.map(d => ({ v: d.value })), [cpuData]);
  const memSpark = useMemo(() => memData.map(d => ({ v: d.value })), [memData]);
  const diskSpark = useMemo(() => diskData.map(d => ({ v: d.value })), [diskData]);
  const memBytesSpark = useMemo(() => memBytesData.map(d => ({ v: d.value })), [memBytesData]);

  return (
    <div className="flex-1 flex flex-col">
      {/* ─── Header ─── */}
      <header className="h-12 flex items-center justify-between px-6 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-[15px] font-bold tracking-tight leading-none">Infrastructure Metrics</h1>
          </div>

          {/* Host selector */}
          {hosts.length > 0 && (
            <div className="flex items-center gap-1 ml-2">
              <div className="h-4 w-px bg-border mx-1" />
              <button onClick={() => setSelectedHost("")}
                className={cn("px-2 py-[3px] rounded-md text-[10px] font-semibold transition-colors",
                  selectedHost === "" ? "bg-primary/10 text-primary" : "text-muted-foreground/50 hover:text-muted-foreground")}>
                All Hosts
              </button>
              {hosts.map(h => (
                <button key={h} onClick={() => setSelectedHost(h)}
                  className={cn("px-2 py-[3px] rounded-md text-[10px] font-mono font-semibold transition-colors max-w-[140px] truncate",
                    selectedHost === h ? "bg-primary/10 text-primary" : "text-muted-foreground/50 hover:text-muted-foreground")}>
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />

          <div className="h-4 w-px bg-border" />

          {/* Status */}
          <div className="flex items-center gap-2">
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-red-400" />
            )}
            <span className={cn("text-[10px] font-semibold", connected ? "text-emerald-500" : "text-red-400")}>
              {connected ? "Live" : "Offline"}
            </span>
            {lastUpdate && (
              <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono">
                {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-auto p-5">
        {/* KPI Row */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <KPICard
            label="CPU Usage" value={latest["cpu.usage_percent"]?.value ?? null}
            prevValue={prevLatest["cpu.usage_percent"]?.value}
            unit="percent" icon={Cpu} color="#3B82F6" sparkData={cpuSpark}
          />
          <KPICard
            label="Memory Usage" value={latest["memory.usage_percent"]?.value ?? null}
            prevValue={prevLatest["memory.usage_percent"]?.value}
            unit="percent" icon={MemoryStick} color="#A855F7" sparkData={memSpark}
          />
          <KPICard
            label="Memory Used" value={latest["memory.used_bytes"]?.value ?? null}
            prevValue={prevLatest["memory.used_bytes"]?.value}
            unit="bytes" icon={HardDrive} color="#8B5CF6" sparkData={memBytesSpark}
          />
          <KPICard
            label="Disk Usage" value={latest["disk.usage_percent"]?.value ?? null}
            prevValue={prevLatest["disk.usage_percent"]?.value}
            unit="percent" icon={Activity} color="#22C55E" sparkData={diskSpark}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <MetricChart title="CPU Usage %" data={cpuData} color="#3B82F6" height={240} />
          <MetricChart title="Memory Usage %" data={memData} color="#A855F7" height={240} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MetricChart title="Disk Usage %" data={diskData} color="#22C55E" height={180} />

          {/* Mini summary cards */}
          <div className="bg-card border border-border rounded-xl p-4 flex flex-col shadow-sm">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">System Summary</h3>
            <div className="flex-1 flex flex-col justify-center gap-3">
              {[
                { label: "CPU", value: latest["cpu.usage_percent"]?.value, color: "#3B82F6" },
                { label: "Memory", value: latest["memory.usage_percent"]?.value, color: "#A855F7" },
                { label: "Disk", value: latest["disk.usage_percent"]?.value, color: "#22C55E" },
              ].map(item => {
                const pct = item.value ?? 0;
                const barColor = pct > 85 ? "#ef4444" : pct > 70 ? "#eab308" : item.color;
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-muted-foreground">{item.label}</span>
                      <span className="text-[11px] font-bold tabular-nums" style={{ color: barColor }}>
                        {item.value != null ? `${item.value.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <div className="h-[5px] rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-border/30">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
                <span>{hosts.length} host{hosts.length !== 1 ? "s" : ""} connected</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last {timeRange}min
                </span>
              </div>
            </div>
          </div>

          {/* Activity feed */}
          <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-sm">
            <div className="px-4 pt-4 pb-2 shrink-0">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recent Activity</h3>
            </div>
            <div className="flex-1 overflow-auto px-3 pb-3">
              {(cpuData || []).slice(-12).reverse().map((d: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 py-1.5 px-1.5 rounded-md hover:bg-muted/30 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.value > 80 ? "#ef4444" : d.value > 60 ? "#eab308" : "#22c55e" }} />
                  <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 tabular-nums">
                    {new Date(d.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className="text-[11px] text-muted-foreground flex-1 truncate">CPU at</span>
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: d.value > 80 ? "#ef4444" : d.value > 60 ? "#eab308" : "#22c55e" }}>
                    {d.value.toFixed(1)}%
                  </span>
                </div>
              ))}
              {cpuData.length === 0 && (
                <div className="flex items-center justify-center h-full text-muted-foreground/30 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Waiting for data…
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
