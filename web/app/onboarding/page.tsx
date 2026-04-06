"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  ArrowRight, ArrowLeft, Building2, Loader2, Globe, CheckCircle2,
  Cloud, Server, Database, Box, Monitor, Layers, Terminal, Copy, Check, Upload, FileJson,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Step 2: Source types ────────────────────────────────────────────────────

type SourceField = {
  key: string;
  label: string;
  placeholder: string;
  sensitive?: boolean;
  fileUpload?: boolean; // accept a JSON file
};

type SourceType = {
  id: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  category: "cloud" | "infra" | "db";
  fields?: SourceField[];
};

const SOURCE_TYPES: SourceType[] = [
  {
    id: "aws", label: "AWS", desc: "CloudWatch, EC2, RDS, Lambda, ECS",
    icon: Cloud, category: "cloud",
    fields: [
      { key: "aws_region", label: "Region", placeholder: "us-east-1" },
      { key: "aws_access_key_id", label: "Access Key ID", placeholder: "AKIAIOSFODNN7EXAMPLE" },
      { key: "aws_secret_access_key", label: "Secret Access Key", placeholder: "••••••••••••••••••••", sensitive: true },
    ],
  },
  {
    id: "gcp", label: "GCP", desc: "Cloud Monitoring, GCE, Cloud SQL, GKE",
    icon: Cloud, category: "cloud",
    fields: [
      { key: "gcp_project_id", label: "Project ID", placeholder: "my-project-123" },
      { key: "gcp_service_account_json", label: "Service Account JSON", placeholder: '{"type":"service_account",...}', sensitive: true, fileUpload: true },
    ],
  },
  {
    id: "azure", label: "Azure", desc: "Azure Monitor, VMs, AKS, Azure SQL",
    icon: Cloud, category: "cloud",
    fields: [
      { key: "azure_subscription_id", label: "Subscription ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "azure_tenant_id", label: "Tenant ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "azure_client_id", label: "Client ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "azure_client_secret", label: "Client Secret", placeholder: "••••••••••••••••••••", sensitive: true },
    ],
  },
  {
    id: "kubernetes", label: "Kubernetes", desc: "Node, pod, and namespace metrics via agent",
    icon: Layers, category: "infra",
    fields: [
      { key: "k8s_api_endpoint", label: "API Server URL", placeholder: "https://my-cluster:6443" },
      { key: "k8s_token", label: "Service Account Token", placeholder: "eyJhbGci...", sensitive: true },
    ],
  },
  {
    id: "linux", label: "Linux Server", desc: "Install the Observo agent via one command",
    icon: Terminal, category: "infra",
  },
  {
    id: "windows", label: "Windows Server", desc: "Install the Observo agent via PowerShell",
    icon: Monitor, category: "infra",
  },
  {
    id: "docker", label: "Docker / Containers", desc: "Run the agent as a sidecar container",
    icon: Box, category: "infra",
  },
  {
    id: "prometheus", label: "Prometheus", desc: "Scrape existing Prometheus metrics endpoint",
    icon: Database, category: "db",
    fields: [
      { key: "prometheus_url", label: "Prometheus URL", placeholder: "http://prometheus:9090" },
    ],
  },
  {
    id: "database", label: "Database", desc: "PostgreSQL, MySQL, MongoDB — install agent on DB host",
    icon: Database, category: "db",
  },
];

// ─── Install commands ────────────────────────────────────────────────────────

function getInstallCommand(sourceId: string, serverUrl: string, apiKey: string): string {
  const envPrefix = [
    `OBSERVO_SERVER_URL=${serverUrl}`,
    apiKey ? `OBSERVO_API_KEY=${apiKey}` : "",
  ].filter(Boolean).join(" ");

  switch (sourceId) {
    case "linux":
      return `curl -sSL ${serverUrl}/install.sh | ${envPrefix} bash`;
    case "windows":
      return `$env:OBSERVO_SERVER_URL="${serverUrl}"\n$env:OBSERVO_API_KEY="${apiKey}"\nInvoke-WebRequest -Uri "${serverUrl}/install.ps1" | Invoke-Expression`;
    case "docker":
      return `docker run -d --name observo-agent \\
  -e OBSERVO_SERVER_URL=${serverUrl} \\
  ${apiKey ? `-e OBSERVO_API_KEY=${apiKey} \\` : ""}
  --pid=host --network=host \\
  -v /proc:/host/proc:ro \\
  -v /sys:/host/sys:ro \\
  observo/agent:latest`;
    case "kubernetes":
      return `helm repo add observo https://charts.observo.io
helm install observo-agent observo/agent \\
  --set server.url=${serverUrl} \\
  ${apiKey ? `--set server.apiKey=${apiKey} \\` : ""}
  --namespace observo --create-namespace`;
    case "database":
      return `${envPrefix} ./observo-agent --tags=role=database`;
    default:
      return `${envPrefix} ./observo-agent`;
  }
}

// ─── File JSON Upload component ──────────────────────────────────────────────

function FileJsonUpload({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");

  const handleFile = (file: File) => {
    setParseError("");
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      try {
        JSON.parse(text); // validate it's valid JSON
        setFileName(file.name);
        onChange(text);
      } catch {
        setParseError("Invalid JSON file. Please select a valid service account key file.");
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="space-y-2">
      <label
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 w-full rounded-lg border-2 border-dashed cursor-pointer transition-all py-5 px-4",
          dragging ? "border-primary bg-primary/5" : value ? "border-green-500/40 bg-green-500/5" : "border-border hover:border-foreground/30 hover:bg-muted/20"
        )}
      >
        <input
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {value ? (
          <>
            <FileJson className="h-6 w-6 text-green-400" />
            <p className="text-[11px] font-semibold text-green-400">{fileName || "service-account.json"}</p>
            <p className="text-[10px] text-muted-foreground">Click to replace</p>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-[12px] font-semibold text-foreground/70">Drop your service account JSON here</p>
            <p className="text-[10px] text-muted-foreground">or click to browse — .json files only</p>
          </>
        )}
      </label>
      {parseError && <p className="text-[11px] text-red-400">{parseError}</p>}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [step, setStep] = useState(1); // 1=org, 2=sources, 3=configure, 4=verify
  const [orgName, setOrgName] = useState("");
  const [orgID, setOrgID] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [generatedApiKey, setGeneratedApiKey] = useState("");

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const serverUrl = process.env.NEXT_PUBLIC_OBSERVO_API_URL || "http://localhost:8080";

  // ── Step 1: Create org ───────────────────────────────────────────────────

  const handleCreateOrg = async () => {
    if (!orgName.trim()) return;
    setLoading(true);
    setError("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      await supabase.from("users").upsert({
        id: user.id,
        email: user.email!,
        full_name: user.user_metadata?.full_name || null,
        avatar_url: user.user_metadata?.avatar_url || null,
      });

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: orgName, slug })
        .select()
        .single();
      if (orgError) throw orgError;

      await supabase.from("memberships").insert({
        user_id: user.id,
        organization_id: org.id,
        role: "owner",
      });

      await supabase.auth.updateUser({
        data: { onboarding_completed: false, organization_id: org.id },
      });

      // Generate an API key for this org
      try {
        const resp = await fetch(`${serverUrl}/v1/apikeys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `${orgName} Default`, org_id: org.id }),
        });
        if (resp.ok) {
          const key = await resp.json();
          if (key.key) setGeneratedApiKey(key.key);
        }
      } catch { /* non-fatal */ }

      setOrgID(org.id);
      setStep(2);
    } catch (err: any) {
      setError(err.message || "Failed to create organization");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: Save cloud data sources ─────────────────────────────────────

  const handleConfigureSources = async () => {
    setLoading(true);
    setError("");
    try {
      for (const srcId of selectedSources) {
        const srcType = SOURCE_TYPES.find(s => s.id === srcId);
        if (!srcType?.fields) continue; // agent-based sources skip this
        const cfg = credentials[srcId] || {};
        await fetch(`${serverUrl}/v1/datasources`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(generatedApiKey ? { "X-API-Key": generatedApiKey } : {}) },
          body: JSON.stringify({
            name: `${srcType.label} (${orgName})`,
            type: srcId,
            config: cfg,
            enabled: true,
          }),
        });
      }
      setStep(4);
    } catch (err: any) {
      setError(err.message || "Failed to save integrations");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 4: Finish ───────────────────────────────────────────────────────

  const handleFinish = async () => {
    await supabase.auth.updateUser({
      data: { onboarding_completed: true },
    });
    // Hard navigate so middleware reads the refreshed session cookie
    window.location.href = "/dashboard";
  };

  const toggleSource = (id: string) => {
    setSelectedSources(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const activeSourceDef = SOURCE_TYPES.find(s => s.id === (activeSource || selectedSources[0]));
  const hasCloudSources = selectedSources.some(id => SOURCE_TYPES.find(s => s.id === id)?.category === "cloud" || SOURCE_TYPES.find(s => s.id === id)?.fields);
  const hasAgentSources = selectedSources.some(id => !SOURCE_TYPES.find(s => s.id === id)?.fields);

  // ── Progress bar ─────────────────────────────────────────────────────────

  const steps = ["Organization", "Data Sources", "Configure", "Verify"];

  return (
    <div className="min-h-screen bg-background flex">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-primary/3 blur-[120px]" />
      </div>

      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-[600px]">

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="text-lg text-primary">◈</span>
              </div>
              <span className="text-base font-bold tracking-tight">Observo</span>
            </div>
            {/* Step dots */}
            <div className="flex items-center gap-2">
              {steps.map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  <div className={cn(
                    "h-1.5 rounded-full transition-all",
                    i + 1 < step ? "w-6 bg-primary" :
                    i + 1 === step ? "w-8 bg-primary" :
                    "w-4 bg-border"
                  )} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Step 1: Org Name ── */}
          {step === 1 && (
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center mb-5">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-xl font-bold tracking-tight mb-1">Create your organization</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Your workspace for metrics, logs, traces, and alerts across any infrastructure.
              </p>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
                Organization Name
              </label>
              <input
                type="text" value={orgName} onChange={e => setOrgName(e.target.value)}
                placeholder="e.g. Acme Corp" autoFocus
                className="w-full h-11 px-4 rounded-lg border border-input bg-background text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground/40 transition-all"
                onKeyDown={e => e.key === "Enter" && handleCreateOrg()}
              />
              {orgName && (
                <div className="flex items-center gap-2 mt-2 px-1">
                  <Globe className="h-3 w-3 text-muted-foreground/50" />
                  <p className="text-[11px] text-muted-foreground">
                    Workspace: <span className="font-mono text-primary font-medium">{slug || "..."}</span>
                  </p>
                </div>
              )}
              {error && (
                <div className="text-[12px] text-red-400 bg-red-500/8 border border-red-500/15 rounded-lg px-3 py-2.5 mt-4 flex items-start gap-2">
                  <span className="mt-px">⚠</span><span>{error}</span>
                </div>
              )}
              <button
                onClick={handleCreateOrg}
                disabled={!orgName.trim() || loading}
                className="mt-6 w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2 group"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" /></>}
              </button>
            </div>
          )}

          {/* ── Step 2: Choose Sources ── */}
          {step === 2 && (
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
              <h1 className="text-xl font-bold tracking-tight mb-1">What do you want to monitor?</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Select all that apply — you can add more later from Settings.
              </p>

              {(["cloud", "infra", "db"] as const).map(cat => (
                <div key={cat} className="mb-5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                    {cat === "cloud" ? "Cloud Providers" : cat === "infra" ? "Infrastructure" : "Databases & Observability"}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {SOURCE_TYPES.filter(s => s.category === cat).map(src => {
                      const selected = selectedSources.includes(src.id);
                      return (
                        <button
                          key={src.id}
                          onClick={() => toggleSource(src.id)}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                            selected
                              ? "border-primary/50 bg-primary/5 text-foreground"
                              : "border-border bg-transparent hover:border-foreground/20 hover:bg-muted/20 text-muted-foreground"
                          )}
                        >
                          <src.icon className={cn("h-4 w-4 mt-0.5 shrink-0", selected ? "text-primary" : "text-muted-foreground/50")} />
                          <div>
                            <p className={cn("text-[12px] font-semibold", selected ? "text-foreground" : "")}>{src.label}</p>
                            <p className="text-[10px] mt-0.5 leading-relaxed">{src.desc}</p>
                          </div>
                          {selected && <CheckCircle2 className="h-4 w-4 text-primary ml-auto shrink-0 mt-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="flex gap-3 mt-2">
                <button onClick={() => setStep(1)} className="h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/30 flex items-center gap-2">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  onClick={() => selectedSources.length > 0 ? setStep(3) : router.push("/dashboard")}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center justify-center gap-2 group"
                >
                  {selectedSources.length === 0 ? "Skip for now" : <>Configure {selectedSources.length} source{selectedSources.length > 1 ? "s" : ""} <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Configure ── */}
          {step === 3 && (
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
              <h1 className="text-xl font-bold tracking-tight mb-1">Configure your integrations</h1>
              <p className="text-sm text-muted-foreground mb-5">
                {hasCloudSources && hasAgentSources
                  ? "Enter cloud credentials and get your agent install command."
                  : hasCloudSources
                  ? "Enter credentials to connect Observo to your cloud accounts."
                  : "Run the install command on each host you want to monitor."}
              </p>

              {/* Source tabs */}
              <div className="flex flex-wrap gap-1.5 mb-5">
                {selectedSources.map(id => {
                  const src = SOURCE_TYPES.find(s => s.id === id)!;
                  const isActive = (activeSource || selectedSources[0]) === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveSource(id)}
                      className={cn(
                        "h-7 px-3 rounded-md text-[11px] font-semibold transition-all",
                        isActive ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
                      )}
                    >
                      {src.label}
                    </button>
                  );
                })}
              </div>

              {/* Active source config */}
              {(() => {
                const srcId = activeSource || selectedSources[0];
                const src = SOURCE_TYPES.find(s => s.id === srcId);
                if (!src) return null;

                if (src.fields) {
                  // Cloud / Prometheus credentials form
                  return (
                    <div className="space-y-3">
                      {src.fields.map(field => (
                        <div key={field.key}>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{field.label}</label>
                          {field.fileUpload ? (
                            <FileJsonUpload
                              value={credentials[srcId]?.[field.key] || ""}
                              onChange={val => setCredentials(prev => ({
                                ...prev,
                                [srcId]: { ...(prev[srcId] || {}), [field.key]: val }
                              }))}
                            />
                          ) : (
                            <input
                              type={field.sensitive ? "password" : "text"}
                              value={credentials[srcId]?.[field.key] || ""}
                              onChange={e => setCredentials(prev => ({
                                ...prev,
                                [srcId]: { ...(prev[srcId] || {}), [field.key]: e.target.value }
                              }))}
                              placeholder={field.placeholder}
                              className="w-full h-9 px-3 bg-background border border-border rounded-lg text-xs font-mono outline-none focus:border-ring"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  );
                }

                // Agent-based install command
                const cmd = getInstallCommand(srcId, serverUrl, generatedApiKey);
                return (
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-2">Run this command on your host:</p>
                    <div className="relative">
                      <pre className="bg-muted/30 border border-border rounded-lg px-4 py-3 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all text-foreground/80">
                        {cmd}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(cmd)}
                        className="absolute top-2 right-2 h-6 px-2 rounded text-[10px] font-medium bg-card border border-border hover:bg-muted/50 flex items-center gap-1"
                      >
                        {copied ? <><Check className="h-3 w-3 text-green-400" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                      </button>
                    </div>
                    {generatedApiKey && (
                      <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Your API Key (save this now)</p>
                        <p className="font-mono text-[11px] break-all text-foreground/80">{generatedApiKey}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">This key won't be shown again. Find it in Settings → API Keys.</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {error && (
                <div className="text-[12px] text-red-400 bg-red-500/8 border border-red-500/15 rounded-lg px-3 py-2.5 mt-4 flex items-start gap-2">
                  <span>⚠</span><span>{error}</span>
                </div>
              )}

              <div className="flex gap-3 mt-5">
                <button onClick={() => setStep(2)} className="h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/30 flex items-center gap-2">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  onClick={hasCloudSources ? handleConfigureSources : () => setStep(4)}
                  disabled={loading}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2 group"
                >
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <>{hasCloudSources ? "Save & Continue" : "Continue"} <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" /></>
                  }
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Verify ── */}
          {step === 4 && (
            <div className="bg-card border border-border rounded-2xl p-8 shadow-sm text-center">
              <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 className="h-8 w-8 text-green-400" />
              </div>
              <h1 className="text-xl font-bold tracking-tight mb-2">You're all set!</h1>
              <p className="text-sm text-muted-foreground mb-6">
                {selectedSources.length > 0
                  ? `Your integrations have been saved. Data will start flowing in within a few minutes.`
                  : `Your organization is ready. Start by installing the agent on a host.`}
              </p>

              <div className="grid grid-cols-3 gap-2 mb-6 text-left">
                {[
                  { label: "Organization", value: orgName },
                  { label: "Sources", value: selectedSources.length > 0 ? selectedSources.map(id => SOURCE_TYPES.find(s => s.id === id)?.label).join(", ") : "None yet" },
                  { label: "API Key", value: generatedApiKey ? generatedApiKey.slice(0, 16) + "…" : "Generated" },
                ].map(item => (
                  <div key={item.label} className="bg-muted/20 rounded-lg p-3">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{item.label}</p>
                    <p className="text-[11px] font-mono font-semibold truncate">{item.value}</p>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-muted-foreground mb-5">
                Head to <strong>Settings → Data Sources</strong> to add more integrations, or <strong>Infrastructure</strong> to see connected agents.
              </p>

              <button
                onClick={handleFinish}
                className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center justify-center gap-2 group"
              >
                Go to Dashboard <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
