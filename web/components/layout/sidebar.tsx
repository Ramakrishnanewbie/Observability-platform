"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BarChart3, ScrollText, Network, Bell, Server,
  Settings, ChevronRight, LayoutDashboard, Zap,
  GitBranch, Activity, ChevronsUpDown,
  Check, Plus, Layers,
} from "lucide-react";
import { observoApi } from "@/lib/observo-api";
import { useDatasource, DataSource as DS } from "@/hooks/use-datasource";

const NAV_GROUPS = [
  {
    label: "Observe",
    items: [
      { href: "/dashboard", label: "Metrics", icon: BarChart3 },
      { href: "/logs", label: "Logs", icon: ScrollText },
      { href: "/traces", label: "Traces", icon: Network },
      { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/apm", label: "APM", icon: Zap },
      { href: "/service-map", label: "Service Map", icon: GitBranch },
    ],
  },
  {
    label: "Respond",
    items: [
      { href: "/alerts", label: "Alerts", icon: Bell },
      { href: "/anomalies", label: "Anomalies", icon: Activity },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/infrastructure", label: "Infrastructure", icon: Server },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// ── Datasource selector types ────────────────────────────────────────────────
type DS = { id: string; name: string; type: string; status: string };

const DS_ICON: Record<string, string> = { gcp: "GCP", aws: "AWS", azure: "AZ", kubernetes: "K8s", prometheus: "Prom" };
const DS_COLOR: Record<string, string> = {
  gcp: "text-blue-400 bg-blue-500/10",
  aws: "text-orange-400 bg-orange-500/10",
  azure: "text-sky-400 bg-sky-500/10",
  kubernetes: "text-purple-400 bg-purple-500/10",
  prometheus: "text-red-400 bg-red-500/10",
};

function DatasourceSelector({ expanded }: { expanded: boolean }) {
  const [open, setOpen] = useState(false);
  const { datasources: sources, selectedDS: selected, setSelectedDS } = useDatasource();
  const current = selected;
  const colorClass = current ? (DS_COLOR[current.type] || "text-muted-foreground bg-muted") : "text-muted-foreground bg-muted";

  if (!expanded) {
    return (
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 mx-auto flex items-center justify-center rounded-md hover:bg-sidebar-accent/50 transition-colors relative"
        title={current?.name || "Select datasource"}
      >
        <div className={cn("w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center", colorClass)}>
          {current ? DS_ICON[current.type] || "?" : <Layers className="h-3 w-3" />}
        </div>
        {current?.status === "connected" && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
        )}
      </button>
    );
  }

  return (
    <div className="relative px-2 mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-sidebar-accent/50 transition-colors"
      >
        <div className={cn("w-7 h-7 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0", colorClass)}>
          {current ? DS_ICON[current.type] || "?" : <Layers className="h-3.5 w-3.5" />}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-semibold text-sidebar-foreground truncate">{current?.name || "No source"}</p>
          <p className="text-[10px] text-sidebar-foreground/40 truncate">
            {current ? (current.status === "connected" ? "● Connected" : "○ Disconnected") : "Add a datasource"}
          </p>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 text-sidebar-foreground/30 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-2 right-2 top-full mt-1 z-50 rounded-lg border border-sidebar-border bg-sidebar shadow-xl overflow-hidden">
          <div className="px-2 pt-2 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/30 px-1 mb-1">Datasources</p>
          </div>
          <div className="max-h-48 overflow-y-auto pb-1">
            {sources.length === 0 ? (
              <p className="text-xs text-sidebar-foreground/40 text-center py-4">No connected sources</p>
            ) : (
              sources.map((ds) => (
                <button
                  key={ds.id}
                  onClick={() => { setSelectedDS(ds); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/50",
                    selected?.id === ds.id && "bg-sidebar-accent"
                  )}
                >
                  <div className={cn("w-6 h-6 rounded text-[9px] font-bold flex items-center justify-center shrink-0", DS_COLOR[ds.type] || "text-muted-foreground bg-muted")}>
                    {DS_ICON[ds.type] || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-sidebar-foreground truncate">{ds.name}</p>
                    <p className="text-[10px] text-sidebar-foreground/40 truncate capitalize">{ds.type}</p>
                  </div>
                  {selected?.id === ds.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))
            )}
          </div>
          <div className="border-t border-sidebar-border p-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Manage datasources
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ firingCount = 0, anomalyCount = 0 }: { firingCount?: number; anomalyCount?: number }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const isHovering = useRef(false);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    isHovering.current = true;
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
    expandTimer.current = setTimeout(() => {
      if (isHovering.current) setExpanded(true);
    }, 60);
  }, []);

  const handleMouseLeave = useCallback(() => {
    isHovering.current = false;
    if (expandTimer.current) { clearTimeout(expandTimer.current); expandTimer.current = null; }
    collapseTimer.current = setTimeout(() => {
      if (!isHovering.current) setExpanded(false);
    }, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
      if (expandTimer.current) clearTimeout(expandTimer.current);
    };
  }, []);

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "fixed left-0 top-0 z-40 h-screen flex-col border-r border-sidebar-border bg-sidebar hidden lg:flex",
        expanded ? "w-60 shadow-xl shadow-black/10" : "w-[52px]"
      )}
      style={{
        transition: expanded
          ? "width 180ms cubic-bezier(0.16, 1, 0.3, 1)"
          : "width 220ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Logo */}
      <div className={cn(
        "flex h-14 items-center border-b border-sidebar-border shrink-0 overflow-hidden",
        expanded ? "px-4" : "justify-center"
      )}>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-xl text-primary">◈</span>
          <span
            className="font-semibold text-sidebar-foreground text-sm whitespace-nowrap"
            style={{
              opacity: expanded ? 1 : 0,
              width: expanded ? "auto" : 0,
              transition: expanded ? "opacity 150ms 60ms ease-out" : "opacity 80ms ease-in",
              overflow: "hidden",
            }}
          >
            Observo
          </span>
        </div>
      </div>

      {/* Datasource Selector */}
      <div className={cn(
        "border-b border-sidebar-border shrink-0",
        expanded ? "py-2" : "py-2 flex justify-center"
      )}>
        <DatasourceSelector expanded={expanded} />
      </div>

      {/* Navigation */}
      <nav className={cn(
        "flex-1 overflow-y-auto overflow-x-hidden",
        expanded ? "py-2 px-2 space-y-6" : "py-2 px-1"
      )}>
        {NAV_GROUPS.map((group, gIdx) => (
          <div key={group.label}>
            {expanded && group.label && (
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold text-sidebar-foreground/30 uppercase tracking-widest">
                {group.label}
              </p>
            )}
            {!expanded && gIdx > 0 && (
              <div className="h-px bg-sidebar-border my-3 mx-1.5" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                const badge =
                  item.href === "/alerts" && firingCount > 0 ? firingCount :
                  item.href === "/anomalies" && anomalyCount > 0 ? anomalyCount : 0;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center rounded-md transition-colors duration-100",
                      expanded ? "h-8 gap-2.5 px-2.5" : "h-9 w-9 mx-auto justify-center",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                        : "text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {expanded && (
                      <>
                        <span className="text-[13px] flex-1 truncate whitespace-nowrap">
                          {item.label}
                        </span>
                        {badge > 0 && (
                          <span className="bg-destructive text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                            {badge}
                          </span>
                        )}
                        {isActive && <ChevronRight className="h-3 w-3 opacity-40 shrink-0" />}
                      </>
                    )}
                    {!expanded && isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                    )}
                    {!expanded && badge > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 bg-destructive text-white text-[8px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={cn(
        "border-t border-sidebar-border p-2 shrink-0",
        !expanded && "flex justify-center"
      )}>
        <div className={cn(
          "flex items-center gap-2.5",
          expanded ? "px-2" : ""
        )}>
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-primary">O</span>
          </div>
          {expanded && (
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-sidebar-foreground">Observo</p>
              <p className="text-[10px] text-muted-foreground">v3.0 · Enterprise</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
