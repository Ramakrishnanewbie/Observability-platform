"use client";

import { Settings, Database, Key, Users, Cloud } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center gap-3">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-base font-bold tracking-tight">Settings</h1>
          <p className="text-[11px] text-muted-foreground">Platform configuration</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 max-w-3xl">
        {[
          { icon: Database, title: "Data Sources", desc: "Connect ClickHouse, configure OpenTelemetry collectors", status: "Active" },
          { icon: Key, title: "API Keys", desc: "Manage agent authentication tokens", status: "Coming soon" },
          { icon: Users, title: "Team", desc: "Invite members, manage roles and permissions", status: "Coming soon" },
          { icon: Cloud, title: "Cloud Integrations", desc: "Connect AWS CloudWatch, GCP Cloud Monitoring, Azure Monitor", status: "Coming soon" },
        ].map((item, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 mb-3 flex items-center gap-4 hover:border-foreground/10 transition-colors cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center shrink-0">
              <item.icon className="h-5 w-5 text-primary/60" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              item.status === "Active" ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"
            }`}>{item.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
