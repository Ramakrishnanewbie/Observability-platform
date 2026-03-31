"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn } from "@/lib/utils";
import { Bell, Plus, X, Trash2 } from "lucide-react";

export default function AlertsPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [firing, setFiring] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", metric_name: "cpu.usage_percent", condition: "gt", threshold: 80, duration_minutes: 1, severity: "warning", enabled: true });

  const fetchAll = useCallback(async () => {
    try {
      const [r, f, h] = await Promise.all([observoApi.getAlertRules(), observoApi.getFiringAlerts(), observoApi.getAlertHistory(60)]);
      setRules(r || []); setFiring(f || []); setHistory(h || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 5000); return () => clearInterval(i); }, [fetchAll]);

  const createRule = async () => {
    await observoApi.createAlertRule(form);
    setShowCreate(false);
    setForm({ name: "", metric_name: "cpu.usage_percent", condition: "gt", threshold: 80, duration_minutes: 1, severity: "warning", enabled: true });
    fetchAll();
  };

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-base font-bold tracking-tight">Alerts</h1>
            <p className="text-[11px] text-muted-foreground">
              {(firing || []).length > 0 ? `🚨 ${firing.length} firing` : "✅ All clear"} · {(rules || []).length} rules
            </p>
          </div>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="h-8 px-4 rounded-md text-xs font-semibold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors flex items-center gap-1.5">
          {showCreate ? <><X className="h-3 w-3" /> Cancel</> : <><Plus className="h-3 w-3" /> Create Rule</>}
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {/* Firing banner */}
        {(firing || []).length > 0 && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 mb-5">
            <h3 className="text-[13px] font-bold text-destructive mb-2">🚨 Firing ({firing.length})</h3>
            {firing.map((a: any, i: number) => (
              <div key={i} className={cn("py-2 flex items-center gap-2 text-sm", i < firing.length - 1 && "border-b border-destructive/10")}>
                <span className="font-semibold text-destructive">{a.rule_name}</span>
                <span className="text-muted-foreground text-xs">on</span>
                <span className="font-mono text-xs">{a.host}</span>
                <span className="text-muted-foreground text-xs">—</span>
                <span className="font-mono text-xs text-orange-400">{a.value?.toFixed(2)} {a.condition} {a.threshold}</span>
              </div>
            ))}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="bg-muted rounded-xl p-5 mb-5 grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. High CPU"
                className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs outline-none focus:border-ring" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Metric</label>
              <select value={form.metric_name} onChange={e => setForm({ ...form, metric_name: e.target.value })}
                className="w-full h-8 px-2 bg-card border border-border rounded-md text-xs outline-none">
                <option value="cpu.usage_percent">CPU Usage %</option>
                <option value="memory.usage_percent">Memory Usage %</option>
                <option value="disk.usage_percent">Disk Usage %</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Condition</label>
              <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })}
                className="w-full h-8 px-2 bg-card border border-border rounded-md text-xs outline-none">
                <option value="gt">Greater than</option><option value="gte">Greater or equal</option>
                <option value="lt">Less than</option><option value="lte">Less or equal</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Threshold</label>
              <input type="number" value={form.threshold} onChange={e => setForm({ ...form, threshold: parseFloat(e.target.value) })}
                className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs font-mono outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Duration (min)</label>
              <input type="number" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: parseInt(e.target.value) })}
                className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs font-mono outline-none" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Severity</label>
              <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}
                className="w-full h-8 px-2 bg-card border border-border rounded-md text-xs outline-none">
                <option value="warning">Warning</option><option value="critical">Critical</option>
              </select>
            </div>
            <div className="col-span-3">
              <button onClick={createRule} disabled={!form.name}
                className={cn("w-full h-9 rounded-md text-xs font-semibold border transition-colors",
                  form.name ? "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/15" : "border-border text-muted-foreground/30")}>
                Create Alert Rule
              </button>
            </div>
          </div>
        )}

        {/* Rules */}
        <div className="bg-card border border-border rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Alert Rules ({(rules || []).length})</h3>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/20">
              {["Name", "Metric", "Condition", "Severity", "Status", ""].map(h => (
                <th key={h} className="text-left p-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(rules || []).length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No alert rules yet</td></tr>
              ) : rules.map((r: any, i: number) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="p-3 font-semibold">{r.name}</td>
                  <td className="p-3"><span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-primary/5">{r.metric_name}</span></td>
                  <td className="p-3 font-mono">{r.condition} {r.threshold} for {r.duration_minutes}m</td>
                  <td className="p-3">
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded",
                      r.severity === "critical" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400")}>{r.severity}</span>
                  </td>
                  <td className="p-3"><span className={r.enabled ? "text-green-400 font-semibold" : "text-muted-foreground"}>
                    {r.enabled ? "Active" : "Disabled"}</span></td>
                  <td className="p-3">
                    <button onClick={() => { observoApi.deleteAlertRule(r.id); fetchAll(); }}
                      className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* History */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Alert History (last hour)</h3>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/20">
              {["Rule", "Host", "Value", "Status", "Fired At"].map(h => (
                <th key={h} className="text-left p-3 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(history || []).length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No alerts triggered yet</td></tr>
              ) : history.map((a: any, i: number) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="p-3">{a.rule_name}</td>
                  <td className="p-3 font-mono text-[11px]">{a.host}</td>
                  <td className="p-3 font-mono">{a.value?.toFixed(2)} {a.condition} {a.threshold}</td>
                  <td className="p-3"><span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded",
                    a.status === "firing" ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")}>{a.status}</span></td>
                  <td className="p-3 text-[11px] text-muted-foreground">{new Date(a.fired_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
