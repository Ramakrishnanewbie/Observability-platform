"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Plus, LayoutDashboard, Clock, MoreHorizontal, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Dashboard } from "@/lib/dashboard-types";

// Default dashboard template
const DEFAULT_DASHBOARD: Omit<Dashboard, "id" | "organization_id" | "created_by"> = {
  name: "New Dashboard",
  description: "Custom monitoring dashboard",
  layout: [
    { i: "w1", x: 16, y: 16, w: 270, h: 140 },
    { i: "w2", x: 302, y: 16, w: 270, h: 140 },
    { i: "w3", x: 588, y: 16, w: 270, h: 140 },
    { i: "w4", x: 874, y: 16, w: 270, h: 140 },
    { i: "w5", x: 16, y: 172, w: 560, h: 300 },
    { i: "w6", x: 592, y: 172, w: 552, h: 300 },
  ],
  widgets: [
    { id: "w1", type: "kpi", title: "CPU Usage", metric: "cpu.usage_percent", color: "#3B82F6" },
    { id: "w2", type: "kpi", title: "Memory Usage", metric: "memory.usage_percent", color: "#A855F7" },
    { id: "w3", type: "kpi", title: "Disk Usage", metric: "disk.usage_percent", color: "#22C55E" },
    { id: "w4", type: "alert_status", title: "Alerts" },
    { id: "w5", type: "area_chart", title: "CPU Over Time", metric: "cpu.usage_percent", color: "#3B82F6" },
    { id: "w6", type: "log_stream", title: "Live Logs" },
  ],
};

export default function DashboardsPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboards();
  }, []);

  const fetchDashboards = async () => {
    setLoading(true);
    try {
      // For now, use localStorage until we add a dashboards table to Supabase
      const stored = localStorage.getItem("observo_dashboards");
      if (stored) {
        setDashboards(JSON.parse(stored));
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const createDashboard = () => {
    const id = crypto.randomUUID();
    const newDash = { ...DEFAULT_DASHBOARD, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const updated = [...dashboards, newDash];
    localStorage.setItem("observo_dashboards", JSON.stringify(updated));
    router.push(`/dashboards/${id}/edit`);
  };

  const deleteDashboard = (id: string) => {
    const updated = dashboards.filter(d => d.id !== id);
    setDashboards(updated);
    localStorage.setItem("observo_dashboards", JSON.stringify(updated));
  };

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-base font-bold tracking-tight">Dashboards</h1>
            <p className="text-[11px] text-muted-foreground">Custom monitoring views · {dashboards.length} dashboards</p>
          </div>
        </div>
        <button
          onClick={createDashboard}
          className="h-8 px-4 rounded-lg text-xs font-semibold border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors flex items-center gap-1.5"
        >
          <Plus className="h-3 w-3" /> New Dashboard
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : dashboards.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mb-5">
              <LayoutDashboard className="h-8 w-8 text-primary/30" />
            </div>
            <h2 className="text-base font-semibold mb-1">No dashboards yet</h2>
            <p className="text-xs text-muted-foreground mb-6 text-center max-w-sm">
              Create custom dashboards with drag-and-drop widgets. Add KPIs, charts, log streams, and more.
            </p>
            <button
              onClick={createDashboard}
              className="h-10 px-6 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> Create Your First Dashboard
            </button>

            {/* Template previews */}
            <div className="grid grid-cols-3 gap-3 mt-10 max-w-lg w-full">
              {[
                { title: "Infrastructure Overview", desc: "CPU, memory, disk + host map", widgets: 6 },
                { title: "Application Monitoring", desc: "Traces, errors, latency", widgets: 8 },
                { title: "Incident Response", desc: "Alerts, logs, key metrics", widgets: 5 },
              ].map((t, i) => (
                <button
                  key={i}
                  onClick={createDashboard}
                  className="p-4 rounded-xl border border-dashed border-border/60 hover:border-primary/20 hover:bg-card/60 transition-all text-left"
                >
                  <LayoutDashboard className="h-5 w-5 text-muted-foreground/30 mb-2" />
                  <p className="text-xs font-semibold mb-0.5">{t.title}</p>
                  <p className="text-[10px] text-muted-foreground">{t.desc}</p>
                  <p className="text-[9px] text-muted-foreground/50 mt-1">{t.widgets} widgets</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Dashboard grid */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {/* Create new card */}
            <button
              onClick={createDashboard}
              className="h-48 rounded-xl border-2 border-dashed border-border/40 hover:border-primary/30 hover:bg-card/60 transition-all flex flex-col items-center justify-center gap-2"
            >
              <Plus className="h-6 w-6 text-muted-foreground/30" />
              <span className="text-xs text-muted-foreground font-medium">New Dashboard</span>
            </button>

            {dashboards.map((dash: any) => (
              <div
                key={dash.id}
                className="h-48 rounded-xl border border-border/50 bg-card hover:border-border transition-all cursor-pointer group relative overflow-hidden"
                onClick={() => router.push(`/dashboards/${dash.id}/edit`)}
              >
                {/* Mini layout preview */}
                <div className="p-3 pb-0" style={{ height: "calc(100% - 60px)" }}>
                  <div className="relative w-full h-full rounded-lg bg-muted/20 border border-border/20 overflow-hidden">
                    {(() => {
                      const items = dash.layout || [];
                      if (items.length === 0) return null;
                      const maxR = Math.max(...items.map((x: any) => x.x + x.w));
                      const maxB = Math.max(...items.map((x: any) => x.y + x.h));
                      return items.slice(0, 8).map((l: any) => (
                        <div
                          key={l.i}
                          className="absolute rounded-sm"
                          style={{
                            left: `${(l.x / maxR) * 100}%`,
                            top: `${(l.y / maxB) * 100}%`,
                            width: `${Math.max((l.w / maxR) * 100, 5)}%`,
                            height: `${Math.max((l.h / maxB) * 100, 10)}%`,
                            background: "hsl(var(--primary) / 0.08)",
                            border: "1px solid hsl(var(--primary) / 0.15)",
                          }}
                        />
                      ));
                    })()}
                  </div>
                </div>

                {/* Info */}
                <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-card from-60% to-transparent">
                  <p className="text-sm font-semibold">{dash.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <LayoutDashboard className="h-3 w-3" /> {(dash.widgets || []).length} widgets
                    </span>
                    {dash.updated_at && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatDistanceToNow(new Date(dash.updated_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteDashboard(dash.id); }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
