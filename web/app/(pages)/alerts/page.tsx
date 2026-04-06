"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn } from "@/lib/utils";
import {
  Bell, Plus, X, Trash2, CheckCheck, Clock, RefreshCw,
  AlertTriangle, CheckCircle2, ShieldAlert,
} from "lucide-react";

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
      severity === "critical" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400")}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string }> = {
    firing: { color: "bg-red-500/10 text-red-400", label: "Firing" },
    resolved: { color: "bg-green-500/10 text-green-400", label: "Resolved" },
    acknowledged: { color: "bg-blue-500/10 text-blue-400", label: "Acknowledged" },
  };
  const c = cfg[status] || cfg.firing;
  return (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", c.color)}>
      {c.label}
    </span>
  );
}

export default function AlertsPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [firing, setFiring] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [historyRange, setHistoryRange] = useState(60);
  const [form, setForm] = useState({
    name: "", metric_name: "cpu.usage_percent", condition: "gt",
    threshold: 80, duration_minutes: 1, severity: "warning", enabled: true,
  });

  const fetchAll = useCallback(async () => {
    try {
      const [r, f, h] = await Promise.all([
        observoApi.getAlertRules(),
        observoApi.getFiringAlerts(),
        observoApi.getAlertHistory(historyRange),
      ]);
      setRules(r || []);
      setFiring(f || []);
      setHistory(h || []);
    } catch (e) { console.error(e); }
  }, [historyRange]);

  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 5000);
    return () => clearInterval(i);
  }, [fetchAll]);

  const createRule = async () => {
    if (!form.name) return;
    await observoApi.createAlertRule(form);
    setShowCreate(false);
    setForm({ name: "", metric_name: "cpu.usage_percent", condition: "gt", threshold: 80, duration_minutes: 1, severity: "warning", enabled: true });
    fetchAll();
  };

  const acknowledge = async (alertId: string) => {
    await observoApi.acknowledgeAlert(alertId);
    fetchAll();
  };

  const unacknowledged = firing.filter(a => !a.acknowledged && a.status !== "acknowledged");
  const acknowledged = firing.filter(a => a.acknowledged || a.status === "acknowledged");

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-base font-bold tracking-tight">Alerts</h1>
            <p className="text-[11px] text-muted-foreground">
              {unacknowledged.length > 0
                ? `${unacknowledged.length} firing, ${acknowledged.length} acknowledged`
                : "All clear"} · {rules.length} rules
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => setShowCreate(!showCreate)}
            className="h-8 px-4 rounded-md text-xs font-semibold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-1.5">
            {showCreate ? <><X className="h-3 w-3" /> Cancel</> : <><Plus className="h-3 w-3" /> Create Rule</>}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Firing alerts banner */}
        {unacknowledged.length > 0 && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              <h3 className="text-[13px] font-bold text-destructive">Firing Alerts ({unacknowledged.length})</h3>
            </div>
            <div className="space-y-2">
              {unacknowledged.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-3 bg-card rounded-lg p-3 border border-destructive/10">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[13px]">{a.rule_name}</span>
                      <SeverityBadge severity={a.severity} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{a.host}</span>
                      <span>·</span>
                      <span className="font-mono text-orange-400">{a.metric_name}: {a.value?.toFixed(2)} {a.condition} {a.threshold}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(a.fired_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => acknowledge(a.id)}
                    className="h-7 px-3 rounded-md text-[11px] font-semibold border border-blue-500/30 text-blue-400 bg-blue-500/5 hover:bg-blue-500/10 flex items-center gap-1.5 shrink-0">
                    <CheckCheck className="h-3 w-3" /> Acknowledge
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acknowledged */}
        {acknowledged.length > 0 && (
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCheck className="h-4 w-4 text-blue-400" />
              <h3 className="text-[12px] font-bold text-blue-400">Acknowledged ({acknowledged.length})</h3>
            </div>
            <div className="space-y-1.5">
              {acknowledged.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-[11px]">
                  <span className="font-semibold text-muted-foreground">{a.rule_name}</span>
                  <span className="font-mono text-muted-foreground/60">{a.host}</span>
                  <StatusBadge status="acknowledged" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All clear */}
        {firing.length === 0 && (
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
            <div>
              <p className="text-[13px] font-bold text-green-400">All systems operational</p>
              <p className="text-[11px] text-muted-foreground">No alerts firing · {rules.filter(r => r.enabled).length} rules active</p>
            </div>
          </div>
        )}

        {/* Create Rule Form */}
        {showCreate && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4">New Alert Rule</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Rule Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. High CPU"
                  className="w-full h-8 px-3 bg-muted/20 border border-border rounded-md text-xs outline-none focus:border-ring" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Metric</label>
                <select value={form.metric_name} onChange={e => setForm({ ...form, metric_name: e.target.value })}
                  className="w-full h-8 px-2 bg-muted/20 border border-border rounded-md text-xs outline-none">
                  <option value="cpu.usage_percent">CPU Usage %</option>
                  <option value="memory.usage_percent">Memory Usage %</option>
                  <option value="disk.usage_percent">Disk Usage %</option>
                  <option value="memory.swap_percent">Swap Usage %</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Condition</label>
                <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })}
                  className="w-full h-8 px-2 bg-muted/20 border border-border rounded-md text-xs outline-none">
                  <option value="gt">Greater than (&gt;)</option>
                  <option value="gte">Greater or equal (≥)</option>
                  <option value="lt">Less than (&lt;)</option>
                  <option value="lte">Less or equal (≤)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Threshold</label>
                <input type="number" value={form.threshold}
                  onChange={e => setForm({ ...form, threshold: parseFloat(e.target.value) })}
                  className="w-full h-8 px-3 bg-muted/20 border border-border rounded-md text-xs font-mono outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  For Duration (min)
                </label>
                <input type="number" value={form.duration_minutes} min={1}
                  onChange={e => setForm({ ...form, duration_minutes: parseInt(e.target.value) })}
                  className="w-full h-8 px-3 bg-muted/20 border border-border rounded-md text-xs font-mono outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Severity</label>
                <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}
                  className="w-full h-8 px-2 bg-muted/20 border border-border rounded-md text-xs outline-none">
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="col-span-3 flex gap-2">
                <button onClick={createRule} disabled={!form.name}
                  className={cn("h-9 px-6 rounded-md text-xs font-semibold border transition-colors",
                    form.name
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                      : "border-border text-muted-foreground/30 cursor-not-allowed")}>
                  Create Alert Rule
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="h-9 px-4 rounded-md text-xs font-semibold border border-border hover:bg-muted/30">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rules Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Alert Rules ({rules.length})
            </h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/20">
                {["Name", "Metric", "Condition", "Duration", "Severity", "Status", ""].map(h => (
                  <th key={h} className="text-left p-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-xs">
                  No alert rules. Click "Create Rule" to get started.
                </td></tr>
              ) : rules.map((r: any, i: number) => (
                <tr key={i} className="border-b border-border/30 hover:bg-muted/10">
                  <td className="p-3 font-semibold">{r.name}</td>
                  <td className="p-3">
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-primary/5">{r.metric_name}</span>
                  </td>
                  <td className="p-3 font-mono text-muted-foreground">{r.condition} {r.threshold}</td>
                  <td className="p-3 text-muted-foreground">{r.duration_minutes}m</td>
                  <td className="p-3"><SeverityBadge severity={r.severity} /></td>
                  <td className="p-3">
                    <span className={r.enabled ? "text-green-400 font-semibold" : "text-muted-foreground"}>
                      {r.enabled ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="p-3">
                    <button onClick={() => { observoApi.deleteAlertRule(r.id); fetchAll(); }}
                      className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* History */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Alert History</h3>
            <div className="flex items-center rounded-md border border-border bg-muted/20 p-[2px]">
              {[
                { label: "1h", value: 60 },
                { label: "6h", value: 360 },
                { label: "24h", value: 1440 },
              ].map(o => (
                <button key={o.value} onClick={() => setHistoryRange(o.value)}
                  className={cn("px-2 py-[2px] rounded text-[10px] font-semibold transition-all",
                    historyRange === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/60")}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/20">
                {["Rule", "Host", "Value → Threshold", "Severity", "Status", "Fired At", "Duration"].map(h => (
                  <th key={h} className="text-left p-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No alert history</td></tr>
              ) : history.map((a: any, i: number) => {
                const duration = a.resolved_at
                  ? ((new Date(a.resolved_at).getTime() - new Date(a.fired_at).getTime()) / 1000 / 60).toFixed(1) + "m"
                  : a.status === "firing" ? "Ongoing" : "—";
                return (
                  <tr key={i} className="border-b border-border/30 hover:bg-muted/10">
                    <td className="p-3 font-semibold">{a.rule_name}</td>
                    <td className="p-3 font-mono text-[11px]">{a.host}</td>
                    <td className="p-3 font-mono text-[11px]">
                      <span className="text-orange-400">{a.value?.toFixed(2)}</span>
                      <span className="text-muted-foreground mx-1">{a.condition}</span>
                      {a.threshold}
                    </td>
                    <td className="p-3"><SeverityBadge severity={a.severity} /></td>
                    <td className="p-3"><StatusBadge status={a.status} /></td>
                    <td className="p-3 text-[11px] text-muted-foreground">
                      {new Date(a.fired_at).toLocaleString()}
                    </td>
                    <td className="p-3 text-[11px] text-muted-foreground font-mono">{duration}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
