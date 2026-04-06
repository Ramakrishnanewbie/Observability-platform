"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { WidgetRenderer } from "@/components/dashboards/widget-renderer";
import { Settings2, X, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WidgetConfig, LayoutItem } from "@/lib/dashboard-types";

interface Props {
  layout: LayoutItem[];
  widgets: WidgetConfig[];
  isEditing: boolean;
  selectedWidgetId: string | null;
  onLayoutChange: (layout: LayoutItem[]) => void;
  onSelectWidget: (id: string | null) => void;
  onDeleteWidget: (id: string) => void;
  onConfigureWidget: (id: string) => void;
  onDuplicateWidget: (id: string) => void;
}

export function DashboardCanvas({
  layout, widgets, isEditing, selectedWidgetId,
  onLayoutChange, onSelectWidget, onDeleteWidget, onConfigureWidget, onDuplicateWidget,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; handle: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  const widgetMap = useMemo(() => {
    const m: Record<string, WidgetConfig> = {};
    widgets.forEach(w => { m[w.id] = w; });
    return m;
  }, [widgets]);

  const layoutMap = useMemo(() => {
    const m: Record<string, LayoutItem> = {};
    layout.forEach(l => { m[l.i] = l; });
    return m;
  }, [layout]);

  // ─── DRAG ───
  const onDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (!isEditing) return;
    e.preventDefault();
    e.stopPropagation();
    const item = layoutMap[id];
    if (!item) return;
    setDragging({ id, startX: e.clientX, startY: e.clientY, origX: item.x, origY: item.y });
    onSelectWidget(id);
  }, [isEditing, layoutMap, onSelectWidget]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      onLayoutChange(layout.map(l =>
        l.i === dragging.id
          ? { ...l, x: Math.max(0, dragging.origX + dx), y: Math.max(0, dragging.origY + dy) }
          : l
      ));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, layout, onLayoutChange]);

  // ─── RESIZE ───
  const onResizeStart = useCallback((e: React.MouseEvent, id: string, handle: string) => {
    if (!isEditing) return;
    e.preventDefault();
    e.stopPropagation();
    const item = layoutMap[id];
    if (!item) return;
    setResizing({ id, handle, startX: e.clientX, startY: e.clientY, origX: item.x, origY: item.y, origW: item.w, origH: item.h });
  }, [isEditing, layoutMap]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - resizing.startX;
      const dy = e.clientY - resizing.startY;
      const h = resizing.handle;
      onLayoutChange(layout.map(l => {
        if (l.i !== resizing.id) return l;
        let x = resizing.origX, y = resizing.origY, w = resizing.origW, ht = resizing.origH;
        if (h.includes("e")) w = Math.max(120, resizing.origW + dx);
        if (h.includes("s")) ht = Math.max(80, resizing.origH + dy);
        if (h.includes("w")) { w = Math.max(120, resizing.origW - dx); x = resizing.origX + dx; }
        if (h.includes("n")) { ht = Math.max(80, resizing.origH - dy); y = resizing.origY + dy; }
        return { ...l, x, y, w, h: ht };
      }));
    };
    const onUp = () => setResizing(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing, layout, onLayoutChange]);

  // Click canvas bg → deselect
  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) onSelectWidget(null);
  }, [onSelectWidget]);

  const maxBottom = layout.reduce((max, l) => Math.max(max, l.y + l.h), 400);

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ minHeight: Math.max(maxBottom + 60, 500) }}
      onClick={onCanvasClick}
    >
      {layout.map((item) => {
        const widget = widgetMap[item.i];
        if (!widget) return null;
        const isSel = selectedWidgetId === item.i;
        const isBeingDragged = dragging?.id === item.i;
        const isBeingResized = resizing?.id === item.i;

        return (
          <div
            key={item.i}
            className="group/widget absolute"
            style={{
              left: item.x,
              top: item.y,
              width: item.w,
              height: item.h,
              zIndex: isSel ? 20 : (isBeingDragged || isBeingResized) ? 30 : 1,
              transition: (isBeingDragged || isBeingResized) ? "none" : "box-shadow 0.2s",
            }}
          >
            {/* Card */}
            <div
              className={cn(
                "h-full w-full flex flex-col overflow-hidden relative rounded-xl border bg-card",
                isSel && isEditing && "border-primary/50 shadow-sm",
                !isSel && isEditing && "border-border/40 hover:border-border/70",
                !isSel && !isEditing && "border-border/20",
              )}
              style={{ borderRadius: 12 }}
              onClick={(e) => { e.stopPropagation(); onSelectWidget(item.i); }}
            >
              {/* Drag surface */}
              {isEditing && (
                <div
                  className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => onDragStart(e, item.i)}
                />
              )}

              {/* Hover action buttons — inside card, top-right */}
              {isEditing && (
                <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-0.5 opacity-0 group-hover/widget:opacity-100 transition-opacity">
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm border border-border/50 hover:bg-accent transition-colors"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onConfigureWidget(item.i); }}
                  >
                    <Settings2 className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm border border-border/50 hover:bg-accent transition-colors"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onDuplicateWidget(item.i); }}
                  >
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm border border-border/50 hover:bg-red-500/10 transition-colors"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onDeleteWidget(item.i); }}
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              )}

              {/* Widget content */}
              <div className="flex-1 min-h-0" style={{ pointerEvents: isEditing ? "none" : "auto" }}>
                <WidgetRenderer config={widget} />
              </div>
            </div>

            {/* Resize handles — OUTSIDE card, 8 handles (4 corners + 4 edges) */}
            {isEditing && isSel && (
              <>
                {/* Corners */}
                <div className="absolute -top-[3px] -left-[3px] w-[7px] h-[7px] bg-muted-foreground/70 rounded-[1px] cursor-nw-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "nw")} />
                <div className="absolute -top-[3px] -right-[3px] w-[7px] h-[7px] bg-muted-foreground/70 rounded-[1px] cursor-ne-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "ne")} />
                <div className="absolute -bottom-[3px] -left-[3px] w-[7px] h-[7px] bg-muted-foreground/70 rounded-[1px] cursor-sw-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "sw")} />
                <div className="absolute -bottom-[3px] -right-[3px] w-[7px] h-[7px] bg-muted-foreground/70 rounded-[1px] cursor-se-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "se")} />
                {/* Edges */}
                <div className="absolute -top-[3px] left-1/2 -translate-x-1/2 w-[14px] h-[5px] bg-muted-foreground/50 rounded-[1px] cursor-n-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "n")} />
                <div className="absolute -bottom-[3px] left-1/2 -translate-x-1/2 w-[14px] h-[5px] bg-muted-foreground/50 rounded-[1px] cursor-s-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "s")} />
                <div className="absolute top-1/2 -left-[3px] -translate-y-1/2 w-[5px] h-[14px] bg-muted-foreground/50 rounded-[1px] cursor-w-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "w")} />
                <div className="absolute top-1/2 -right-[3px] -translate-y-1/2 w-[5px] h-[14px] bg-muted-foreground/50 rounded-[1px] cursor-e-resize z-30 border border-background" onMouseDown={(e) => onResizeStart(e, item.i, "e")} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
