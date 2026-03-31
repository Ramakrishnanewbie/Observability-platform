"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Search, X, Filter, Radio, Pause, RefreshCw,
  AlertCircle, AlertTriangle, Info, Bug, Skull, ScrollText,
} from "lucide-react";

const LEVEL_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  fatal: { label: "FATAL", icon: Skull, color: "text-red-500", bg: "bg-red-500/10" },
  error: { label: "ERROR", icon: AlertCircle, color: "text-orange-400", bg: "bg-orange-400/10" },
  warn:  { label: "WARN",  icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-400/10" },
  info:  { label: "INFO",  icon: Info, color: "text-blue-400", bg: "bg-blue-400/10" },
  debug: { label: "DEBUG", icon: Bug, color: "text-zinc-400", bg: "bg-zinc-400/10" },
};

function LevelBadge({ level }: { level: string }) {
  const c = LEVEL_CONFIG[level] || LEVEL_CONFIG.info;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider", c.color, c.bg)}>
      {c.label}
    </span>
  );
}

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [severity, setSeverity] = useState("");
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [showFacets, setShowFacets] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      let params = "limit=200";
      if (search) params += `&search=${encodeURIComponent(search)}`;
      if (severity) params += `&severity=${severity}`;
      const [l, s] = await Promise.all([observoApi.getLogs(params), observoApi.getLogStats()]);
      setLogs(l || []); setStats(s || []);
    } catch (e) { console.error(e); }
  }, [search, severity]);

  useEffect(() => { fetchLogs(); if (!isLive) return; const i = setInterval(fetchLogs, 5000); return () => clearInterval(i); }, [fetchLogs, isLive]);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 400); return () => clearTimeout(t); }, [searchInput]);

  const total = (stats || []).reduce((s: number, x: any) => s + x.count, 0);
  const cnt = (sev: string) => (stats || []).find((s: any) => s.severity === sev)?.count || 0;
  const errorCount = cnt("error") + cnt("fatal");

  return (
    <div className="flex flex-col h-[calc(100vh-0px)]">
      {/* Top bar */}
      <div className="shrink-0 border-b border-border px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <ScrollText className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-base font-bold tracking-tight">Logs</h1>
              <p className="text-[11px] text-muted-foreground">Platform observability · {total.toLocaleString()} events</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-500/30 text-red-400 font-semibold flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {errorCount} errors
              </span>
            )}
            <Button
              variant={isLive ? "default" : "outline"}
              size="sm"
              className={cn("h-7 text-[11px] gap-1.5", isLive && "bg-green-600 hover:bg-green-700 text-white")}
              onClick={() => setIsLive(!isLive)}
            >
              {isLive ? <><Radio className="h-3 w-3 animate-pulse" /> Live</> : <><Pause className="h-3 w-3" /> Paused</>}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => fetchLogs()}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
        {/* Search */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-[11px] shrink-0 gap-1" onClick={() => setShowFacets(!showFacets)}>
            <Filter className="h-3 w-3" /> Facets
          </Button>
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search logs... (e.g. permission denied, timeout)"
              className="w-full h-7 pl-8 pr-8 bg-muted/30 border border-muted rounded-md text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-ring" />
            {searchInput && (
              <button onClick={() => { setSearchInput(""); setSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Facet sidebar */}
        {showFacets && (
          <div className="w-[200px] shrink-0 border-r border-border overflow-y-auto py-3 px-3 space-y-5">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2">Severity</p>
              {[{ key: "", label: "All", count: total }, ...Object.entries(LEVEL_CONFIG).map(([k, v]) => ({ key: k, label: v.label, count: cnt(k) }))].map(item => (
                <button key={item.key} onClick={() => setSeverity(item.key)}
                  className={cn("w-full flex items-center justify-between px-2 py-1 rounded text-[11px] font-mono transition-colors mb-0.5",
                    severity === item.key ? "bg-muted" : "opacity-50 hover:opacity-80")}>
                  <div className="flex items-center gap-1.5">
                    {item.key && <span className={cn("w-2 h-2 rounded-full", LEVEL_CONFIG[item.key]?.bg, LEVEL_CONFIG[item.key]?.color)} />}
                    <span>{item.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/50">{item.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Log stream */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Headers */}
          <div className="shrink-0 flex items-center border-b border-border bg-muted/20 text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">
            <div className="w-[145px] px-2.5 py-1.5">Timestamp</div>
            <div className="w-[55px] py-1.5">Level</div>
            <div className="w-[120px] py-1.5">Source</div>
            <div className="flex-1 py-1.5">Message</div>
            <div className="w-[80px] py-1.5 pr-3">Host</div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {(logs || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <ScrollText className="h-10 w-10 opacity-20 mb-3" />
                <p className="text-sm font-medium">No logs found</p>
                <p className="text-[11px] opacity-50 mt-1">Logs will appear as the agent collects them</p>
              </div>
            ) : logs.map((log: any, i: number) => {
              const c = LEVEL_CONFIG[log.severity] || LEVEL_CONFIG.info;
              const borderColor = log.severity === "fatal" ? "border-l-red-500" : log.severity === "error" ? "border-l-orange-400" : log.severity === "warn" ? "border-l-yellow-400" : log.severity === "info" ? "border-l-blue-400" : "border-l-zinc-400";
              return (
                <button key={i} onClick={() => setSelectedLog(selectedLog === log ? null : log)}
                  className={cn("w-full text-left flex items-start border-l-2 border-b border-b-border/30 transition-colors", borderColor,
                    selectedLog === log ? "bg-muted/40" : "hover:bg-muted/20")}>
                  <div className="shrink-0 w-[145px] px-2.5 py-2 text-[11px] font-mono text-muted-foreground/70 tabular-nums">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                  <div className="shrink-0 w-[55px] py-2"><LevelBadge level={log.severity} /></div>
                  <div className="shrink-0 w-[120px] py-2 pr-2 text-[11px] font-mono text-muted-foreground truncate">{log.source}</div>
                  <div className="flex-1 py-2 pr-3 min-w-0">
                    <p className="text-[12px] font-mono truncate text-foreground/90">{log.message}</p>
                  </div>
                  <div className="shrink-0 w-[80px] py-2 pr-3 text-[10px] font-mono text-muted-foreground/50">{log.host}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selectedLog && (
          <div className="w-[400px] shrink-0 border-l border-border bg-background overflow-y-auto">
            <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LevelBadge level={selectedLog.severity} />
                <span className="text-[11px] font-mono text-muted-foreground">Log Entry</span>
              </div>
              <button onClick={() => setSelectedLog(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Message</p>
              <p className="text-sm font-mono leading-relaxed break-words whitespace-pre-wrap">{selectedLog.message}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground mb-2">Attributes</p>
              {[
                { l: "Timestamp", v: new Date(selectedLog.timestamp).toLocaleString() },
                { l: "Severity", v: selectedLog.severity?.toUpperCase() },
                { l: "Source", v: selectedLog.source },
                { l: "Host", v: selectedLog.host },
              ].filter(a => a.v).map(a => (
                <div key={a.l} className="flex justify-between mb-1.5">
                  <span className="text-[11px] text-muted-foreground/70">{a.l}</span>
                  <span className="text-[11px] font-mono">{a.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
