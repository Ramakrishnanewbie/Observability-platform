"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WIDGET_TYPES, type WidgetType } from "@/lib/dashboard-types";
import {
  Hash, AreaChart, TrendingUp, BarChart3, ScrollText,
  Table, Network, Bell, Server, Type, Search,
} from "lucide-react";

const ICON_MAP: Record<string, any> = {
  Hash, AreaChart, TrendingUp, BarChart3, ScrollText,
  Table, Network, Bell, Server, Type,
};

const CATEGORY_LABELS: Record<string, string> = {
  kpi: "KPI & Text",
  chart: "Charts",
  data: "Data Views",
  status: "Status",
};

interface Props {
  onSelect: (type: WidgetType) => void;
}

export function WidgetGallery({ onSelect }: Props) {
  const [search, setSearch] = useState("");

  const filtered = WIDGET_TYPES.filter(w =>
    !search || w.label.toLowerCase().includes(search.toLowerCase()) || w.description.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = ["kpi", "chart", "data", "status"].reduce((acc, cat) => {
    const items = filtered.filter(w => w.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {} as Record<string, typeof filtered>);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground/40" />
          <input
            placeholder="Search widgets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-7 pl-8 pr-3 bg-muted/30 border border-border rounded-md text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-ring"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 px-1">
              {CATEGORY_LABELS[cat]}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((widget) => {
                const Icon = ICON_MAP[widget.icon] || Hash;
                return (
                  <button
                    key={widget.type}
                    onClick={() => onSelect(widget.type)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 transition-all text-center group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                      <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium leading-tight">{widget.label}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">{widget.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
