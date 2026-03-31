"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { DashboardCanvas } from "@/components/dashboards/dashboard-canvas";
import { WidgetGallery } from "@/components/dashboards/widget-gallery";
import { PropertiesPanel } from "@/components/dashboards/properties-panel";
import { WIDGET_TYPES, type WidgetConfig, type LayoutItem, type WidgetType } from "@/lib/dashboard-types";
import {
  ArrowLeft, Plus, Eye, Pencil, LayoutDashboard, Check, X as XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function DashboardEditPage() {
  const router = useRouter();
  const params = useParams();
  const dashId = params.id as string;

  const [name, setName] = useState("New Dashboard");
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [isEditing, setIsEditing] = useState(true);
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load
  useEffect(() => {
    try {
      const stored = localStorage.getItem("observo_dashboards");
      if (stored) {
        const dashes = JSON.parse(stored);
        const dash = dashes.find((d: any) => d.id === dashId);
        if (dash) { setName(dash.name); setLayout(dash.layout || []); setWidgets(dash.widgets || []); }
      }
    } catch {}
  }, [dashId]);

  // Auto-save
  const saveDashboard = useCallback(() => {
    try {
      const stored = localStorage.getItem("observo_dashboards");
      const dashes = stored ? JSON.parse(stored) : [];
      const idx = dashes.findIndex((d: any) => d.id === dashId);
      const updated = { id: dashId, name, layout, widgets, updated_at: new Date().toISOString() };
      if (idx >= 0) dashes[idx] = { ...dashes[idx], ...updated };
      else dashes.push({ ...updated, created_at: new Date().toISOString() });
      localStorage.setItem("observo_dashboards", JSON.stringify(dashes));
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch {}
  }, [dashId, name, layout, widgets]);

  useEffect(() => { const t = setTimeout(saveDashboard, 1500); return () => clearTimeout(t); }, [layout, widgets, name]);

  // Add widget (places in a cascading position)
  const addWidget = (type: WidgetType) => {
    const def = WIDGET_TYPES.find(w => w.type === type);
    if (!def) return;
    const id = `w-${Date.now()}`;
    // Find a good position — below existing widgets
    const maxY = layout.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    const nextX = (layout.length % 3) * (def.defaultSize.w + 16) + 16;
    setLayout(prev => [...prev, { i: id, x: nextX, y: maxY + 16, w: def.defaultSize.w, h: def.defaultSize.h }]);
    setWidgets(prev => [...prev, {
      id, type, title: def.label,
      metric: ["kpi", "area_chart", "line_chart", "bar_chart"].includes(type) ? "cpu.usage_percent" : undefined,
      color: ["#3B82F6", "#A855F7", "#22C55E", "#F97316", "#EF4444"][Math.floor(Math.random() * 5)],
      timeRange: 10,
    }]);
    setShowGallery(false);
    setSelectedWidget(id);
  };

  const duplicateWidget = (id: string) => {
    const src = widgets.find(w => w.id === id);
    const srcL = layout.find(l => l.i === id);
    if (!src || !srcL) return;
    const newId = `w-${Date.now()}`;
    setLayout(prev => [...prev, { i: newId, x: srcL.x + 24, y: srcL.y + 24, w: srcL.w, h: srcL.h }]);
    setWidgets(prev => [...prev, { ...src, id: newId, title: `${src.title} (copy)` }]);
    setSelectedWidget(newId);
  };

  const deleteWidget = (id: string) => {
    setLayout(prev => prev.filter(l => l.i !== id));
    setWidgets(prev => prev.filter(w => w.id !== id));
    if (selectedWidget === id) setSelectedWidget(null);
  };

  const updateWidget = (id: string, field: string, value: any) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, [field]: value } : w));
  };

  // Delete key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedWidget) deleteWidget(selectedWidget);
      if (e.key === "Escape") { setSelectedWidget(null); setShowGallery(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedWidget]);

  const selectedWidgetConfig = widgets.find(w => w.id === selectedWidget);

  return (
    <div className="flex flex-col h-[calc(100vh-44px)]">
      {/* Toolbar */}
      <div className="shrink-0 h-11 border-b border-border px-4 flex items-center justify-between bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/dashboards")}
            className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-4 w-px bg-border" />
          <LayoutDashboard className="h-3.5 w-3.5 text-primary/60" />
          {editingName ? (
            <input value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditingName(false); }}
              onBlur={() => setEditingName(false)} autoFocus
              className="h-7 px-2 bg-background border border-ring rounded-md text-sm font-semibold outline-none w-52" />
          ) : (
            <button onClick={() => isEditing && setEditingName(true)}
              className="text-sm font-semibold hover:text-primary transition-colors flex items-center gap-1.5 group">
              {name}
              {isEditing && <Pencil className="h-2.5 w-2.5 text-muted-foreground/30 group-hover:text-primary/50" />}
            </button>
          )}
          <span className="text-[10px] text-muted-foreground/40 font-mono">{widgets.length} widgets</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-muted/20 p-[3px]">
            <button onClick={() => setIsEditing(true)}
              className={cn("px-2.5 py-[3px] rounded text-[11px] font-medium transition-all flex items-center gap-1.5",
                isEditing ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
              <Pencil className="h-3 w-3" /> Edit
            </button>
            <button onClick={() => { setIsEditing(false); setSelectedWidget(null); setShowGallery(false); }}
              className={cn("px-2.5 py-[3px] rounded text-[11px] font-medium transition-all flex items-center gap-1.5",
                !isEditing ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
              <Eye className="h-3 w-3" /> View
            </button>
          </div>
          {isEditing && (
            <button onClick={() => setShowGallery(!showGallery)}
              className={cn("h-7 px-3 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors",
                showGallery ? "border border-border text-muted-foreground" : "border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10")}>
              {showGallery ? <><XIcon className="h-3 w-3" /> Close</> : <><Plus className="h-3 w-3" /> Add Widget</>}
            </button>
          )}
          <div className={cn("text-[10px] font-semibold flex items-center gap-1 transition-all duration-300",
            saved ? "text-green-400 opacity-100" : "opacity-0")}>
            <Check className="h-3 w-3" /> Saved
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {showGallery && isEditing && (
          <div className="w-[240px] shrink-0 border-r border-border bg-card overflow-hidden">
            <WidgetGallery onSelect={addWidget} />
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 bg-background">
          {widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-14 h-14 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mb-4">
                <Plus className="h-7 w-7 text-primary/25" />
              </div>
              <p className="text-sm font-semibold mb-1">Empty dashboard</p>
              <p className="text-xs text-muted-foreground mb-5">Click &quot;Add Widget&quot; to start building</p>
              <button onClick={() => setShowGallery(true)}
                className="h-9 px-5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2">
                <Plus className="h-3.5 w-3.5" /> Add Your First Widget
              </button>
            </div>
          ) : (
            <DashboardCanvas
              layout={layout}
              widgets={widgets}
              isEditing={isEditing}
              selectedWidgetId={selectedWidget}
              onLayoutChange={setLayout}
              onSelectWidget={setSelectedWidget}
              onDeleteWidget={deleteWidget}
              onConfigureWidget={(id) => setSelectedWidget(id)}
              onDuplicateWidget={duplicateWidget}
            />
          )}
        </div>

        {isEditing && selectedWidgetConfig && (
          <PropertiesPanel
            widget={selectedWidgetConfig}
            onUpdate={(field, value) => updateWidget(selectedWidgetConfig.id, field, value)}
            onClose={() => setSelectedWidget(null)}
          />
        )}
      </div>
    </div>
  );
}
