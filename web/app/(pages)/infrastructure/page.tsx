"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn } from "@/lib/utils";
import { Server, Cpu, MemoryStick, HardDrive, Terminal } from "lucide-react";

function MetricBar({ label, value, color }: { label: string; value?: number; color: string }) {
  const pct = value ?? 0;
  const barColor = pct > 85 ? "bg-destructive" : pct > 70 ? "bg-yellow-500" : "";
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
        <span className={cn("text-[11px] font-mono font-semibold", pct > 85 ? "text-destructive" : pct > 70 ? "text-yellow-500" : "")}
          style={{ color: pct <= 70 ? color : undefined }}>
          {value !== undefined ? `${value.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${Math.min(pct, 100)}%`, background: pct <= 70 ? color : undefined }} />
      </div>
    </div>
  );
}

export default function InfrastructurePage() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [hostMetrics, setHostMetrics] = useState<Record<string, Record<string, number>>>({});

  const fetchData = useCallback(async () => {
    try {
      const h = await observoApi.getHosts();
      setHosts(h || []);
      const latest = await observoApi.getLatest();
      const byHost: Record<string, Record<string, number>> = {};
      (latest || []).forEach((m: any) => {
        if (!byHost[m.host]) byHost[m.host] = {};
        byHost[m.host][m.metric_name] = m.value;
      });
      setHostMetrics(byHost);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 5000); return () => clearInterval(i); }, [fetchData]);

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center gap-3">
        <Server className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-base font-bold tracking-tight">Infrastructure</h1>
          <p className="text-[11px] text-muted-foreground">Multi-host monitoring · {(hosts || []).length} hosts</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {(hosts || []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Server className="h-12 w-12 text-muted-foreground/15 mb-4" />
            <p className="text-sm font-semibold text-muted-foreground">No hosts detected</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Start the Observo agent on your machines</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            {hosts.map(host => {
              const m = hostMetrics[host] || {};
              return (
                <div key={host} className="bg-card border border-border rounded-xl p-5 hover:border-foreground/10 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/5 flex items-center justify-center">
                        <Server className="h-4.5 w-4.5 text-primary" />
                      </div>
                      <div>
                        <p className="font-mono text-[13px] font-semibold">{host}</p>
                        <p className="text-[10px] text-muted-foreground">Agent connected</p>
                      </div>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
                  </div>
                  <div className="space-y-3">
                    <MetricBar label="CPU" value={m["cpu.usage_percent"]} color="#3B82F6" />
                    <MetricBar label="Memory" value={m["memory.usage_percent"]} color="#A855F7" />
                    <MetricBar label="Disk" value={m["disk.usage_percent"]} color="#22C55E" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Deploy instructions */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Deploy Agent</h3>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Deploy the Observo agent on any machine (Windows, Linux, macOS) to start collecting metrics, logs, and traces.
          </p>
          <div className="bg-muted rounded-lg p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Start</p>
            <pre className="text-[11px] font-mono text-primary leading-relaxed whitespace-pre-wrap">{`# Clone the repo on the target machine
git clone <your-repo>
cd Observability-platform

# Edit server URL in cmd/agent/main.go
# serverURL = "http://YOUR_SERVER_IP:8080"

# Run the agent
go run ./cmd/agent/main.go`}</pre>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            <strong>Coming soon:</strong> OpenTelemetry Collector integration for cloud-native deployments
          </p>
        </div>
      </div>
    </div>
  );
}
