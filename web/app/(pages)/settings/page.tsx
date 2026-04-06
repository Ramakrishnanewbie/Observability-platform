"use client";

import { useState, useEffect, useCallback } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn } from "@/lib/utils";
import {
  Settings, Database, Key, Users, Bell, Plus, Trash2, Send,
  CheckCircle2, XCircle, Loader2, X, Cloud, Server, Layers,
  Eye, EyeOff, Copy, Check, RefreshCw, AlertCircle,
} from "lucide-react";

// ─── Notification Channels ───────────────────────────────────────────────────

type Channel = { id: string; name: string; type: string; url: string; enabled: boolean };

function NotificationChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "webhook", url: "", enabled: true });
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, "ok" | "error">>({});

  const load = useCallback(async () => {
    try { setChannels(await observoApi.getNotifChannels() || []); } catch { setChannels([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name || !form.url) return;
    await observoApi.createNotifChannel(form);
    setForm({ name: "", type: "webhook", url: "", enabled: true });
    setShowAdd(false);
    load();
  };

  const remove = async (id: string) => { await observoApi.deleteNotifChannel(id); load(); };

  const test = async (ch: Channel) => {
    setTesting(ch.id);
    try {
      await observoApi.testNotifChannel(ch);
      setTestResult(p => ({ ...p, [ch.id]: "ok" }));
    } catch {
      setTestResult(p => ({ ...p, [ch.id]: "error" }));
    } finally {
      setTesting(null);
      setTimeout(() => setTestResult(p => { const n = { ...p }; delete n[ch.id]; return n; }), 3000);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Notification Channels</p>
            <p className="text-[11px] text-muted-foreground">Receive alerts via Slack or webhooks</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="h-7 px-3 rounded-md text-[11px] font-semibold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-1.5">
          {showAdd ? <><X className="h-3 w-3" /> Cancel</> : <><Plus className="h-3 w-3" /> Add</>}
        </button>
      </div>
      {showAdd && (
        <div className="p-5 bg-muted/20 border-b border-border grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Production Slack"
              className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs outline-none focus:border-ring" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
              className="w-full h-8 px-2 bg-card border border-border rounded-md text-xs outline-none">
              <option value="slack">Slack Webhook</option>
              <option value="webhook">Generic Webhook</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Webhook URL</label>
            <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
              placeholder={form.type === "slack" ? "https://hooks.slack.com/services/..." : "https://your-webhook.example.com/alert"}
              className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs font-mono outline-none focus:border-ring" />
          </div>
          <div className="col-span-2">
            <button onClick={create} disabled={!form.name || !form.url}
              className={cn("h-9 px-6 rounded-md text-xs font-semibold border transition-colors",
                form.name && form.url ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : "border-border text-muted-foreground/30 cursor-not-allowed")}>
              Add Channel
            </button>
          </div>
        </div>
      )}
      <div className="divide-y divide-border">
        {channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10">
            <Bell className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">No channels configured</p>
          </div>
        ) : channels.map(ch => (
          <div key={ch.id} className="flex items-center gap-4 px-5 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{ch.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono truncate">{ch.type} · {ch.url}</p>
            </div>
            <div className="flex items-center gap-2">
              {testResult[ch.id] === "ok" && <CheckCircle2 className="h-4 w-4 text-green-400" />}
              {testResult[ch.id] === "error" && <XCircle className="h-4 w-4 text-red-400" />}
              <button onClick={() => test(ch)} disabled={testing === ch.id}
                className="h-7 px-3 rounded-md border border-border text-[11px] font-medium hover:bg-muted/30 flex items-center gap-1.5">
                {testing === ch.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Test
              </button>
              <button onClick={() => remove(ch.id)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted/30">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Data Sources ─────────────────────────────────────────────────────────────

const DS_ICONS: Record<string, React.ElementType> = {
  aws: Cloud, gcp: Cloud, azure: Cloud, kubernetes: Layers,
  prometheus: Database, linux: Server, windows: Server, docker: Server, database: Database,
};

const DS_FIELDS: Record<string, { key: string; label: string; sensitive?: boolean; multiline?: boolean; placeholder?: string }[]> = {
  aws: [
    { key: "aws_region", label: "Region" },
    { key: "aws_access_key_id", label: "Access Key ID" },
    { key: "aws_secret_access_key", label: "Secret Key", sensitive: true },
  ],
  gcp: [
    { key: "gcp_project_id", label: "Project ID" },
    { key: "gcp_service_account_json", label: "Service Account JSON", multiline: true, placeholder: '{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...","client_email":"..."}' },
  ],
  azure: [
    { key: "azure_subscription_id", label: "Subscription ID" },
    { key: "azure_tenant_id", label: "Tenant ID" },
    { key: "azure_client_id", label: "Client ID" },
    { key: "azure_client_secret", label: "Client Secret", sensitive: true },
  ],
  kubernetes: [
    { key: "k8s_api_endpoint", label: "API Endpoint" },
    { key: "k8s_token", label: "Bearer Token", sensitive: true },
  ],
  prometheus: [
    { key: "prometheus_url", label: "Prometheus URL" },
  ],
};

const DS_TYPE_LABELS: Record<string, string> = {
  aws: "AWS CloudWatch", gcp: "GCP Cloud Monitoring", azure: "Azure Monitor",
  kubernetes: "Kubernetes", prometheus: "Prometheus", linux: "Linux Agent",
  windows: "Windows Agent", docker: "Docker / Container", database: "Database Host",
};

function DataSources() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [form, setForm] = useState<{ name: string; type: string; config: Record<string, string> }>({
    name: "", type: "aws", config: {},
  });

  const load = useCallback(async () => {
    try { setSources(await observoApi.getDataSources() || []); } catch { setSources([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name) return;
    setLoading(true);
    try {
      await observoApi.createDataSource({ ...form, enabled: true });
      setShowAdd(false);
      setForm({ name: "", type: "aws", config: {} });
      setTimeout(load, 3000); // wait for async backend connection test (GCP/AWS auth takes time)
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const remove = async (id: string) => {
    await observoApi.deleteDataSource(id);
    setSources(p => p.filter(s => s.id !== id));
  };

  const testConn = async (ds: any) => {
    setTesting(ds.id);
    try {
      const result = await observoApi.testDataSource(ds);
      setTestResults(p => ({ ...p, [ds.id]: result }));
    } catch (e: any) {
      setTestResults(p => ({ ...p, [ds.id]: { success: false, message: e.message } }));
    } finally {
      setTesting(null);
    }
  };

  const statusColor = (status: string) => {
    if (status === "connected") return "text-green-400 bg-green-500/10";
    if (status === "error") return "text-red-400 bg-red-500/10";
    return "text-yellow-400 bg-yellow-500/10";
  };

  const fields = DS_FIELDS[form.type] || [];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Data Sources</p>
            <p className="text-[11px] text-muted-foreground">AWS, GCP, Azure, Kubernetes, on-prem, databases</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="h-7 px-3 rounded-md text-[11px] font-semibold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-1.5">
          {showAdd ? <><X className="h-3 w-3" /> Cancel</> : <><Plus className="h-3 w-3" /> Add Source</>}
        </button>
      </div>

      {showAdd && (
        <div className="p-5 bg-muted/20 border-b border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Production AWS"
                className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs outline-none focus:border-ring" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Type</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, config: {} })}
                className="w-full h-8 px-2 bg-card border border-border rounded-md text-xs outline-none">
                {Object.entries(DS_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{f.label}</label>
              {f.multiline ? (
                <textarea
                  rows={6}
                  value={form.config[f.key] || ""}
                  placeholder={f.placeholder}
                  onChange={e => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                  className="w-full px-3 py-2 bg-card border border-border rounded-md text-xs font-mono outline-none focus:border-ring resize-y"
                />
              ) : (
                <input
                  type={f.sensitive ? "password" : "text"}
                  value={form.config[f.key] || ""}
                  onChange={e => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                  className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs font-mono outline-none focus:border-ring"
                />
              )}
            </div>
          ))}
          <button onClick={create} disabled={!form.name || loading}
            className={cn("h-9 px-6 rounded-md text-xs font-semibold border transition-colors",
              form.name ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : "border-border text-muted-foreground/30 cursor-not-allowed")}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Add & Test"}
          </button>
        </div>
      )}

      {/* Built-in ClickHouse */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border/40">
        <Database className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        <div className="flex-1">
          <p className="text-[13px] font-semibold">ClickHouse (local)</p>
          <p className="text-[11px] text-muted-foreground">{process.env.NEXT_PUBLIC_OBSERVO_API_URL || "localhost"}:9000 · Metrics, Logs, Traces</p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-green-400 bg-green-500/10">Connected</span>
      </div>

      <div className="divide-y divide-border">
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Cloud className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">No external sources connected yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Add AWS, GCP, Azure, Kubernetes, or Prometheus</p>
          </div>
        ) : sources.map(ds => {
          const Icon = DS_ICONS[ds.type] || Database;
          const tr = testResults[ds.id];
          return (
            <div key={ds.id} className="flex items-start gap-3 px-5 py-3">
              <div className="w-8 h-8 rounded-md bg-primary/5 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="h-4 w-4 text-primary/60" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-[13px] font-semibold">{ds.name}</p>
                  <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-full", statusColor(ds.status))}>
                    {ds.status || "pending"}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">{DS_TYPE_LABELS[ds.type] || ds.type}</p>
                {ds.error && (
                  <p className="text-[10px] text-red-400 flex items-center gap-1 mt-0.5">
                    <AlertCircle className="h-3 w-3" /> {ds.error}
                  </p>
                )}
                {tr && (
                  <p className={cn("text-[10px] mt-0.5 flex items-center gap-1", tr.success ? "text-green-400" : "text-red-400")}>
                    {tr.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {tr.message}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => testConn(ds)} disabled={testing === ds.id}
                  className="h-7 px-2.5 rounded-md border border-border text-[10px] font-medium hover:bg-muted/30 flex items-center gap-1">
                  {testing === ds.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Test
                </button>
                <button onClick={() => remove(ds.id)}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted/30">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

function APIKeys() {
  const [keys, setKeys] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<{ raw: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRevoke, setShowRevoke] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setKeys(await observoApi.getAPIKeys() || []); } catch { setKeys([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const k = await observoApi.createAPIKey({ name });
      setNewKey({ raw: k.key, name: k.name });
      setName(""); setShowAdd(false);
      load();
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const revoke = async (id: string) => {
    await observoApi.revokeAPIKey(id);
    setShowRevoke(null);
    setKeys(p => p.filter(k => k.id !== id));
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">API Keys</p>
            <p className="text-[11px] text-muted-foreground">Authenticate agents and programmatic access</p>
          </div>
        </div>
        <button onClick={() => { setShowAdd(!showAdd); setNewKey(null); }}
          className="h-7 px-3 rounded-md text-[11px] font-semibold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-1.5">
          {showAdd ? <><X className="h-3 w-3" /> Cancel</> : <><Plus className="h-3 w-3" /> Create Key</>}
        </button>
      </div>

      {/* New key banner */}
      {newKey && (
        <div className="px-5 py-4 bg-green-500/5 border-b border-green-500/15">
          <div className="flex items-start gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] font-semibold text-green-400">API key created: {newKey.name}</p>
              <p className="text-[11px] text-muted-foreground">Copy this key now — it won't be shown again.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono bg-muted/30 border border-border rounded px-3 py-2 overflow-hidden text-ellipsis">
              {newKey.raw}
            </code>
            <button onClick={() => copy(newKey.raw)}
              className="h-8 px-3 rounded-md border border-green-500/30 text-[11px] font-medium text-green-400 hover:bg-green-500/10 flex items-center gap-1.5 shrink-0">
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Use as: <code className="font-mono">OBSERVO_API_KEY={newKey.raw}</code> or HTTP header <code className="font-mono">X-API-Key: {newKey.raw}</code>
          </p>
        </div>
      )}

      {showAdd && (
        <div className="p-5 bg-muted/20 border-b border-border flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Key Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. prod-agent-us-east"
              onKeyDown={e => e.key === "Enter" && create()}
              className="w-full h-8 px-3 bg-card border border-border rounded-md text-xs outline-none focus:border-ring" />
          </div>
          <button onClick={create} disabled={!name.trim() || loading}
            className={cn("h-8 px-5 rounded-md text-xs font-semibold border transition-colors",
              name.trim() ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : "border-border text-muted-foreground/30 cursor-not-allowed")}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Generate"}
          </button>
        </div>
      )}

      <div className="divide-y divide-border">
        {keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Key className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">No API keys yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Create a key to authenticate agents and automation</p>
          </div>
        ) : keys.map(k => (
          <div key={k.id} className="flex items-center gap-4 px-5 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold">{k.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono">{k.prefix} · Created {new Date(k.created_at).toLocaleDateString()}</p>
              {k.last_used && <p className="text-[10px] text-muted-foreground">Last used: {new Date(k.last_used).toLocaleString()}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">Active</span>
              {showRevoke === k.id ? (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Revoke?</span>
                  <button onClick={() => revoke(k.id)} className="h-6 px-2 rounded text-[10px] font-semibold bg-destructive/10 text-destructive hover:bg-destructive/20">Yes</button>
                  <button onClick={() => setShowRevoke(null)} className="h-6 px-2 rounded text-[10px] border border-border hover:bg-muted/30">No</button>
                </div>
              ) : (
                <button onClick={() => setShowRevoke(k.id)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted/30">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    observoApi.getHealth().then(h => setHealth(h)).catch(() => setHealth(null));
    observoApi.getPlatformStats().then(s => setHealth((p: any) => ({ ...p, stats: s }))).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center gap-3">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-base font-bold tracking-tight">Settings</h1>
          <p className="text-[11px] text-muted-foreground">Integrations, API keys, and platform configuration</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-4">

        {/* Platform status */}
        {health && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Platform Status</h3>
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full",
                health.status === "ok" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                {health.status === "ok" ? "● Operational" : "● Degraded"}
              </span>
            </div>
            {health.stats && (
              <div className="grid grid-cols-6 gap-3">
                {[
                  { label: "Hosts", value: health.stats.total_hosts },
                  { label: "Metrics/hr", value: health.stats.total_metrics_1h?.toLocaleString() },
                  { label: "Logs/hr", value: health.stats.total_logs_1h?.toLocaleString() },
                  { label: "Spans/hr", value: health.stats.total_spans_1h?.toLocaleString() },
                  { label: "Firing Alerts", value: health.stats.firing_alerts },
                  { label: "Events/min", value: health.stats.events_per_minute?.toFixed(0) },
                ].map(item => (
                  <div key={item.label} className="bg-muted/20 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</div>
                    <div className="text-[18px] font-bold tabular-nums mt-1">{item.value ?? "—"}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-3">
              Server v{health.version} · {health.time ? new Date(health.time).toLocaleString() : ""}
            </p>
          </div>
        )}

        {/* Data Sources */}
        <DataSources />

        {/* Notification Channels */}
        <NotificationChannels />

        {/* API Keys */}
        <APIKeys />

        {/* Bottom row — 2 columns */}
        <div className="grid grid-cols-2 gap-4">
          {/* Team & RBAC */}
          <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 text-primary/60" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Team & RBAC</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Invite members, manage roles (Owner, Admin, Member, Viewer)</p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Coming soon</span>
          </div>

          {/* Data Retention */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Data Retention</h3>
            <div className="space-y-2">
              {[
                { label: "Metrics", retention: "30 days" },
                { label: "Logs", retention: "30 days" },
                { label: "Traces / Spans", retention: "30 days" },
                { label: "Process Metrics", retention: "1 day" },
                { label: "Network Metrics", retention: "7 days" },
                { label: "Alert History", retention: "90 days" },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
                  <span className="text-[12px] text-muted-foreground">{item.label}</span>
                  <span className="text-[11px] font-mono font-semibold">{item.retention}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* OTLP info */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">OpenTelemetry (OTLP) Receiver</h3>
          <p className="text-[12px] text-muted-foreground mb-3">
            Any app with an OpenTelemetry SDK can send traces, metrics, and logs directly to Observo.
          </p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { endpoint: "POST /v1/otlp/v1/traces", desc: "Traces (JSON)" },
              { endpoint: "POST /v1/otlp/v1/metrics", desc: "Metrics (JSON)" },
              { endpoint: "POST /v1/otlp/v1/logs", desc: "Logs (JSON)" },
            ].map((item, i) => (
              <div key={i} className="bg-muted/20 rounded-lg px-3 py-2">
                <code className="text-[10px] font-mono text-primary block truncate">{item.endpoint}</code>
                <span className="text-[10px] text-muted-foreground">{item.desc}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Set <code className="font-mono text-primary">OTEL_EXPORTER_OTLP_ENDPOINT={process.env.NEXT_PUBLIC_OBSERVO_API_URL || "http://localhost:8080"}/v1/otlp</code>
          </p>
        </div>

        </div>{/* end max-w-5xl */}
      </div>
    </div>
  );
}
