"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn, formatBytes } from "@/lib/utils";
import {
  Server, Cpu, MemoryStick, HardDrive, Network, Activity,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, ChevronDown,
} from "lucide-react";

function MetricBar({ label, value, color }: { label: string; value?: number; color: string }) {
  const pct = value ?? 0;
  const barColor = pct > 85 ? "#ef4444" : pct > 70 ? "#eab308" : color;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
        <span className="text-[11px] font-mono font-semibold" style={{ color: barColor }}>
          {value !== undefined ? `${value.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
      </div>
    </div>
  );
}

function hostStatus(m: Record<string, number>) {
  const cpu = m["cpu.usage_percent"] ?? 0;
  const mem = m["memory.usage_percent"] ?? 0;
  const disk = m["disk.usage_percent"] ?? 0;
  if (cpu > 85 || mem > 90 || disk > 90) return "critical";
  if (cpu > 70 || mem > 80 || disk > 80) return "warning";
  return "healthy";
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className={cn("w-2 h-2 rounded-full inline-block",
      status === "critical" ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" :
      status === "warning" ? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.4)]" :
      "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]")} />
  );
}

function AgentCard({ agent }: { agent: any }) {
  const color = agent.status === "healthy" ? "#22c55e" : agent.status === "stale" ? "#eab308" : "#ef4444";
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
      <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: `${color}15` }}>
        <Server className="h-4 w-4" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[11px] font-semibold truncate">{agent.host}</p>
        <p className="text-[9px] text-muted-foreground">{agent.platform} · v{agent.version}</p>
      </div>
      <div className="text-right">
        <span className="text-[10px] font-semibold" style={{ color }}>
          {agent.status}
        </span>
        <p className="text-[9px] text-muted-foreground">{agent.seconds_ago?.toFixed(0)}s ago</p>
      </div>
    </div>
  );
}

function ProcessTable({ processes }: { processes: any[] }) {
  if (!processes || processes.length === 0) return (
    <div className="text-xs text-muted-foreground/40 py-4 text-center">No process data</div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/40">
            {["PID", "Name", "CPU%", "Memory", "Status"].map(h => (
              <th key={h} className="text-left pb-2 pr-3 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {processes.slice(0, 15).map((p: any, i: number) => (
            <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{p.pid}</td>
              <td className="py-1.5 pr-3 font-semibold max-w-[120px] truncate">{p.name}</td>
              <td className="py-1.5 pr-3">
                <span className={cn("font-mono", p.cpu_percent > 50 ? "text-red-400" : p.cpu_percent > 20 ? "text-yellow-400" : "")}>
                  {p.cpu_percent.toFixed(1)}%
                </span>
              </td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                {formatBytes(p.mem_bytes)}
              </td>
              <td className="py-1.5">
                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-semibold",
                  p.status === "running" ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground")}>
                  {p.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NetworkTable({ networks }: { networks: any[] }) {
  if (!networks || networks.length === 0) return (
    <div className="text-xs text-muted-foreground/40 py-4 text-center">No network data</div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/40">
            {["Interface", "Bytes Recv", "Bytes Sent", "Packets Recv", "Packets Sent", "Errors"].map(h => (
              <th key={h} className="text-left pb-2 pr-3 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {networks.map((n: any, i: number) => (
            <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
              <td className="py-1.5 pr-3 font-mono font-semibold">{n.interface}</td>
              <td className="py-1.5 pr-3 font-mono text-blue-400">{formatBytes(n.bytes_recv)}</td>
              <td className="py-1.5 pr-3 font-mono text-green-400">{formatBytes(n.bytes_sent)}</td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{n.packets_recv?.toLocaleString()}</td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{n.packets_sent?.toLocaleString()}</td>
              <td className="py-1.5 font-mono text-muted-foreground">
                {(n.errin || 0) + (n.errout || 0) > 0
                  ? <span className="text-red-400">{(n.errin || 0) + (n.errout || 0)}</span>
                  : <span className="text-green-500/60">0</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InfrastructurePage() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [hostMetrics, setHostMetrics] = useState<Record<string, Record<string, number>>>({});
  const [agents, setAgents] = useState<any[]>([]);
  const [processes, setProcesses] = useState<Record<string, any[]>>({});
  const [networks, setNetworks] = useState<Record<string, any[]>>({});
  const [expandedHost, setExpandedHost] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, "metrics" | "processes" | "network">>({});

  const fetchData = useCallback(async () => {
    try {
      const [h, latest, agentList, netLatest] = await Promise.all([
        observoApi.getHosts(),
        observoApi.getLatest(),
        observoApi.getAgents().catch(() => []),
        observoApi.getNetworkLatest().catch(() => []),
      ]);

      setHosts(h || []);
      setAgents(agentList || []);

      // Group metrics by host
      const byHost: Record<string, Record<string, number>> = {};
      (latest || []).forEach((m: any) => {
        if (!byHost[m.host]) byHost[m.host] = {};
        byHost[m.host][m.metric_name] = m.value;
      });
      setHostMetrics(byHost);

      // Group network by host
      const netByHost: Record<string, any[]> = {};
      (netLatest || []).forEach((n: any) => {
        if (!netByHost[n.host]) netByHost[n.host] = [];
        netByHost[n.host].push(n);
      });
      setNetworks(netByHost);
    } catch (e) { console.error(e); }
  }, []);

  const fetchProcesses = useCallback(async (host: string) => {
    try {
      const data = await observoApi.getProcesses(host);
      setProcesses(prev => ({ ...prev, [host]: data || [] }));
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 5000);
    return () => clearInterval(i);
  }, [fetchData]);

  useEffect(() => {
    if (expandedHost) {
      fetchProcesses(expandedHost);
    }
  }, [expandedHost, fetchProcesses]);

  const healthCounts = hosts.reduce(
    (acc, h) => {
      const status = hostStatus(hostMetrics[h] || {});
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-base font-bold tracking-tight">Infrastructure</h1>
            <p className="text-[11px] text-muted-foreground">
              {hosts.length} hosts · {agents.length} agents ·
              <span className="text-green-400 ml-1">{healthCounts.healthy || 0} healthy</span>
              {healthCounts.warning > 0 && <span className="text-yellow-400 ml-1">· {healthCounts.warning} warning</span>}
              {healthCounts.critical > 0 && <span className="text-red-400 ml-1">· {healthCounts.critical} critical</span>}
            </p>
          </div>
        </div>
        <button onClick={fetchData}
          className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Agent status panel */}
        {agents.length > 0 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Agent Status ({agents.length})
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 px-4 pb-4">
              {agents.map((agent: any, i: number) => (
                <AgentCard key={i} agent={agent} />
              ))}
            </div>
          </div>
        )}

        {/* Host cards */}
        {hosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Server className="h-12 w-12 text-muted-foreground/15 mb-4" />
            <p className="text-sm font-semibold text-muted-foreground">No hosts detected</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Start the Observo agent on your machines</p>
          </div>
        ) : (
          <div className="space-y-3">
            {hosts.map(host => {
              const m = hostMetrics[host] || {};
              const status = hostStatus(m);
              const isExpanded = expandedHost === host;
              const tab = activeTab[host] || "metrics";

              return (
                <div key={host} className={cn(
                  "bg-card border border-border rounded-xl overflow-hidden transition-all",
                  status === "critical" && "border-red-500/30",
                  status === "warning" && "border-yellow-500/30",
                )}>
                  {/* Host header row */}
                  <div
                    className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/20"
                    onClick={() => {
                      setExpandedHost(isExpanded ? null : host);
                      if (!isExpanded) fetchProcesses(host);
                    }}
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center shrink-0">
                      <Server className="h-5 w-5 text-primary/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-[13px] font-bold">{host}</p>
                        <StatusDot status={status} />
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Cpu className="h-3 w-3" /> {m["cpu.usage_percent"]?.toFixed(1) ?? "—"}%
                        </span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <MemoryStick className="h-3 w-3" /> {m["memory.usage_percent"]?.toFixed(1) ?? "—"}%
                        </span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <HardDrive className="h-3 w-3" /> {m["disk.usage_percent"]?.toFixed(1) ?? "—"}%
                        </span>
                        {m["memory.used_bytes"] && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatBytes(m["memory.used_bytes"])} / {formatBytes(m["memory.total_bytes"] || 0)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress bars (compact) */}
                    <div className="hidden xl:flex items-center gap-6 w-80">
                      {[
                        { label: "CPU", v: m["cpu.usage_percent"], color: "#3b82f6" },
                        { label: "MEM", v: m["memory.usage_percent"], color: "#a855f7" },
                        { label: "DISK", v: m["disk.usage_percent"], color: "#22c55e" },
                      ].map(bar => {
                        const pct = bar.v ?? 0;
                        const barC = pct > 85 ? "#ef4444" : pct > 70 ? "#eab308" : bar.color;
                        return (
                          <div key={bar.label} className="flex-1">
                            <div className="flex justify-between text-[9px] mb-1">
                              <span className="text-muted-foreground">{bar.label}</span>
                              <span style={{ color: barC }}>{pct.toFixed(0)}%</span>
                            </div>
                            <div className="h-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: barC }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      {/* Tab bar */}
                      <div className="flex items-center gap-1 px-4 pt-3 border-b border-border">
                        {[
                          { key: "metrics", label: "System Metrics", icon: Activity },
                          { key: "processes", label: "Processes", icon: Cpu },
                          { key: "network", label: "Network", icon: Network },
                        ].map(t => (
                          <button key={t.key}
                            onClick={() => setActiveTab(prev => ({ ...prev, [host]: t.key as any }))}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors",
                              tab === t.key
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                            )}>
                            <t.icon className="h-3 w-3" />
                            {t.label}
                          </button>
                        ))}
                      </div>

                      <div className="p-4">
                        {tab === "metrics" && (
                          <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">CPU & Memory</h4>
                              <MetricBar label="CPU Usage" value={m["cpu.usage_percent"]} color="#3b82f6" />
                              <MetricBar label="Memory Usage" value={m["memory.usage_percent"]} color="#a855f7" />
                              {m["memory.swap_percent"] !== undefined && (
                                <MetricBar label="Swap Usage" value={m["memory.swap_percent"]} color="#6366f1" />
                              )}
                            </div>
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Storage & I/O</h4>
                              <MetricBar label="Disk Usage" value={m["disk.usage_percent"]} color="#22c55e" />
                              {m["memory.used_bytes"] && (
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-muted-foreground">Memory Used</span>
                                  <span className="font-mono font-semibold">{formatBytes(m["memory.used_bytes"])} / {formatBytes(m["memory.total_bytes"] || 0)}</span>
                                </div>
                              )}
                              {m["disk.used_bytes"] && (
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-muted-foreground">Disk Used</span>
                                  <span className="font-mono font-semibold">{formatBytes(m["disk.used_bytes"])} / {formatBytes(m["disk.total_bytes"] || 0)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {tab === "processes" && (
                          <ProcessTable processes={processes[host] || []} />
                        )}

                        {tab === "network" && (
                          <NetworkTable networks={networks[host] || []} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Deploy instructions */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Deploy Agent</h3>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Deploy the Observo agent on any machine to collect metrics, logs, traces, process, and network data.
          </p>
          <div className="bg-muted rounded-lg p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Start</p>
            <pre className="text-[11px] font-mono text-primary leading-relaxed whitespace-pre-wrap">{`# Clone the repo on the target machine
git clone <your-repo>
cd Observability-platform

# Edit server URL in cmd/agent/main.go:
# serverURL = "http://YOUR_SERVER_IP:8080"

# Run the agent
go run ./cmd/agent/main.go`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
