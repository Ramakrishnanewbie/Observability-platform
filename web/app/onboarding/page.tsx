"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { ArrowRight, Building2, Loader2, BarChart3, ScrollText, Network, Bell, Server, Globe } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleCreateOrg = async () => {
    if (!orgName.trim()) return;
    setLoading(true);
    setError("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 1. User first (FK dependency)
      const { error: userError } = await supabase
        .from("users")
        .upsert({
          id: user.id,
          email: user.email!,
          full_name: user.user_metadata?.full_name || null,
          avatar_url: user.user_metadata?.avatar_url || null,
        });
      if (userError) throw userError;

      // 2. Organization
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: orgName, slug })
        .select()
        .single();
      if (orgError) throw orgError;

      // 3. Membership
      const { error: memError } = await supabase
        .from("memberships")
        .insert({ user_id: user.id, organization_id: org.id, role: "owner" });
      if (memError) throw memError;

      // 4. Mark complete
      await supabase.auth.updateUser({
        data: { onboarding_completed: true, organization_id: org.id },
      });

      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Failed to create organization");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-primary/3 blur-[120px]" />
      </div>

      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-[520px]">
          {/* Logo + Progress */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="text-lg text-primary">◈</span>
              </div>
              <span className="text-base font-bold tracking-tight">Observo</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 rounded-full bg-primary" />
              <div className="w-8 h-1 rounded-full bg-border" />
            </div>
          </div>

          {/* Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center mb-5">
              <Building2 className="h-6 w-6 text-primary" />
            </div>

            <h1 className="text-xl font-bold tracking-tight mb-1">Create your organization</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Your workspace for metrics, logs, traces, and alerts. Invite your team later.
            </p>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
                Organization Name
              </label>
              <input
                type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Acme Corp" autoFocus
                className="w-full h-11 px-4 rounded-lg border border-input bg-background text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground/40 transition-all"
                onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
              />
            </div>

            {orgName && (
              <div className="flex items-center gap-2 mb-5 px-1">
                <Globe className="h-3 w-3 text-muted-foreground/50" />
                <p className="text-[11px] text-muted-foreground">
                  Workspace: <span className="font-mono text-primary font-medium">{slug || "..."}</span>
                </p>
              </div>
            )}

            {error && (
              <div className="text-[12px] text-red-400 bg-red-500/8 border border-red-500/15 rounded-lg px-3 py-2.5 mb-4 flex items-start gap-2">
                <span className="mt-px">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleCreateOrg}
              disabled={!orgName.trim() || loading}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </div>

          {/* Features preview */}
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              { icon: BarChart3, title: "Metrics", desc: "CPU, memory, disk, custom" },
              { icon: ScrollText, title: "Logs", desc: "Search & filter in real-time" },
              { icon: Network, title: "Traces", desc: "Distributed request tracing" },
            ].map((item) => (
              <div key={item.title} className="text-center p-4 rounded-xl border border-dashed border-border/60 bg-card/30 hover:border-primary/20 hover:bg-card/60 transition-all">
                <item.icon className="h-5 w-5 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-xs font-semibold mb-0.5">{item.title}</p>
                <p className="text-[10px] text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { icon: Bell, title: "Alerts", desc: "Threshold-based alerting" },
              { icon: Server, title: "Infrastructure", desc: "Multi-host monitoring" },
              { icon: Globe, title: "Multi-cloud", desc: "AWS, GCP, Azure, on-prem" },
            ].map((item) => (
              <div key={item.title} className="text-center p-4 rounded-xl border border-dashed border-border/60 bg-card/30 hover:border-primary/20 hover:bg-card/60 transition-all">
                <item.icon className="h-5 w-5 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-xs font-semibold mb-0.5">{item.title}</p>
                <p className="text-[10px] text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
