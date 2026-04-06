"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BarChart3, ScrollText, Network, Bell, Server,
  Settings, ChevronRight, LayoutDashboard, Zap,
  GitBranch, Activity, AlertTriangle,
} from "lucide-react";

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
