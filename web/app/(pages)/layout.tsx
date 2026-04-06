"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { observoApi } from "@/lib/observo-api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { LogOut, User, Settings, ChevronDown, Keyboard } from "lucide-react";

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [firingCount, setFiringCount] = useState(0);
  const [anomalyCount, setAnomalyCount] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Get current user + org
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user?.user_metadata?.organization_id) {
        const { data } = await supabase
          .from("organizations")
          .select("*")
          .eq("id", user.user_metadata.organization_id)
          .single();
        setOrg(data);
      }
    };
    init();
  }, []);

  // Poll firing alerts
  useEffect(() => {
    const poll = async () => {
      try {
        const [f, a] = await Promise.all([
          observoApi.getFiringAlerts(),
          observoApi.getAnomalies(60).catch(() => []),
        ]);
        setFiringCount((f || []).length);
        setAnomalyCount((a || []).filter((x: any) => x.severity === "critical").length);
      } catch {}
    };
    poll();
    const i = setInterval(poll, 5000);
    return () => clearInterval(i);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showUserMenu]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/auth");
  };

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <>
      <Sidebar firingCount={firingCount} anomalyCount={anomalyCount} />
      <main className="min-h-screen flex flex-col bg-background lg:ml-[52px]">
        {/* Top bar */}
        <div className="h-11 flex items-center justify-between px-5 border-b border-border bg-card/80 backdrop-blur-sm shrink-0 z-30">
          {/* Left: org name */}
          <div className="flex items-center gap-2">
            {org && (
              <>
                <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-primary">{org.name?.[0]?.toUpperCase()}</span>
                </div>
                <span className="text-[12px] font-semibold text-foreground/80">{org.name}</span>
                <span className="text-[10px] text-muted-foreground/40">/</span>
              </>
            )}
            <span className="text-[10px] text-muted-foreground font-mono">workspace</span>
          </div>

          {/* Right: user */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors"
            >
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} className="w-6 h-6 rounded-full" alt="" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-primary">{initials}</span>
                </div>
              )}
              <span className="text-[11px] text-muted-foreground font-medium hidden sm:block">
                {displayName}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-56 bg-card border border-border rounded-xl shadow-xl shadow-black/20 z-50 py-1 animate-scale-in">
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-xs font-semibold truncate">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
                  {org && <p className="text-[10px] text-primary/70 truncate mt-0.5">{org.name}</p>}
                </div>
                <div className="py-1">
                  <button onClick={() => { router.push("/settings"); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                    <Settings className="h-3.5 w-3.5" /> Settings
                  </button>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                    <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts
                    <span className="ml-auto text-[9px] text-muted-foreground/40 font-mono">1-5</span>
                  </button>
                </div>
                <div className="border-t border-border pt-1">
                  <button onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/5 transition-colors">
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 flex flex-col">
          {children}
        </div>

        {/* Footer */}
        <footer className="px-5 py-2.5 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground/50 shrink-0">
          <span>Observo v3.0 — Metrics · Logs · Traces · APM · Alerts</span>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline">Press <kbd className="px-1 py-0.5 rounded bg-muted text-muted-foreground/60 font-mono text-[9px]">1</kbd>-<kbd className="px-1 py-0.5 rounded bg-muted text-muted-foreground/60 font-mono text-[9px]">5</kbd> to navigate</span>
            <span>Refreshing every 5s</span>
          </div>
        </footer>
      </main>
    </>
  );
}
