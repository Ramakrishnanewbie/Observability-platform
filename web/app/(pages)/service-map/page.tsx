"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { observoApi } from "@/lib/observo-api";
import { cn } from "@/lib/utils";
import { GitBranch, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

const TIME_OPTIONS = [
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "4h", value: 240 },
  { label: "24h", value: 1440 },
];

function serviceColor(service: string) {
  const colors = [
    "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
    "#06b6d4", "#ef4444", "#84cc16", "#f97316", "#6366f1",
  ];
  let hash = 0;
  for (let i = 0; i < service.length; i++) {
    hash = service.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function errorBadgeColor(rate: number) {
  if (rate < 1) return "#22c55e";
  if (rate < 5) return "#eab308";
  return "#ef4444";
}

// Simple force-directed layout (static, computed once)
function computeLayout(nodes: string[], edges: any[]) {
  const W = 900, H = 550, padding = 80;
  const pos: Record<string, { x: number; y: number }> = {};

  if (nodes.length === 0) return pos;

  // Find entry nodes (nodes that are never a callee = root services)
  const callees = new Set(edges.map(e => e.callee));
  const roots = nodes.filter(n => !callees.has(n));

  // BFS layer assignment
  const layer: Record<string, number> = {};
  const queue: string[] = roots.length > 0 ? [...roots] : [nodes[0]];
  queue.forEach(n => { layer[n] = 0; });

  const adjList: Record<string, string[]> = {};
  edges.forEach(e => {
    if (!adjList[e.caller]) adjList[e.caller] = [];
    adjList[e.caller].push(e.callee);
  });

  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    const children = adjList[cur] || [];
    children.forEach(child => {
      if (layer[child] === undefined) {
        layer[child] = (layer[cur] || 0) + 1;
        queue.push(child);
      }
    });
  }

  // Any unvisited nodes get layer 99
  nodes.forEach(n => { if (layer[n] === undefined) layer[n] = 99; });

  const maxLayer = Math.max(...Object.values(layer));
  const layerNodes: Record<number, string[]> = {};
  nodes.forEach(n => {
    const l = layer[n] > 4 ? 4 : layer[n]; // cap at 4 layers
    if (!layerNodes[l]) layerNodes[l] = [];
    layerNodes[l].push(n);
  });

  const numLayers = Math.min(maxLayer + 1, 5);
  Object.entries(layerNodes).forEach(([l, ns]) => {
    const lNum = parseInt(l);
    const x = padding + (lNum / Math.max(numLayers - 1, 1)) * (W - 2 * padding);
    ns.forEach((n, i) => {
      const y = padding + ((i + 1) / (ns.length + 1)) * (H - 2 * padding);
      pos[n] = { x, y };
    });
  });

  return pos;
}

// ─── Arrow ───
function Arrow({ x1, y1, x2, y2, color, width }: { x1: number; y1: number; x2: number; y2: number; color: string; width: number }) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 10) return null;
  const r = 24; // node radius
  const ex = x2 - (dx / len) * r;
  const ey = y2 - (dy / len) * r;
  const sx = x1 + (dx / len) * r;
  const sy = y1 + (dy / len) * r;

  // Quadratic bezier control point (slight curve)
  const mx = (sx + ex) / 2 - dy * 0.12;
  const my = (sy + ey) / 2 + dx * 0.12;

  return (
    <g>
      <defs>
        <marker id={`arrow-${color.replace("#", "")}`} markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={color} opacity={0.6} />
        </marker>
      </defs>
      <path
        d={`M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeOpacity={0.5}
        markerEnd={`url(#arrow-${color.replace("#", "")})`}
      />
    </g>
  );
}

export default function ServiceMapPage() {
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const [timeRange, setTimeRange] = useState(60);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const fetchGraph = useCallback(async () => {
    try {
      const data = await observoApi.getServiceGraph(timeRange);
      setGraph(data || { nodes: [], edges: [] });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchGraph();
    const i = setInterval(fetchGraph, 30000);
    return () => clearInterval(i);
  }, [fetchGraph]);

  const nodeIds = useMemo(() => (graph.nodes || []).map((n: any) => n.id), [graph.nodes]);
  const layout = useMemo(() => computeLayout(nodeIds, graph.edges || []), [nodeIds, graph.edges]);

  // Node stats map
  const nodeStats = useMemo(() => {
    const m: Record<string, any> = {};
    (graph.nodes || []).forEach((n: any) => { m[n.id] = n; });
    return m;
  }, [graph.nodes]);

  // Edge thickness based on call volume
  const maxCalls = useMemo(() => {
    return Math.max(...(graph.edges || []).map((e: any) => e.calls || 1), 1);
  }, [graph.edges]);

  function handleMouseDown(e: React.MouseEvent) {
    dragging.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.startX;
    const dy = e.clientY - dragging.current.startY;
    setPan({ x: dragging.current.panX + dx, y: dragging.current.panY + dy });
  }
  function handleMouseUp() { dragging.current = null; }

  const selectedEdges = useMemo(() => {
    if (!selected) return [];
    return (graph.edges || []).filter((e: any) => e.caller === selected || e.callee === selected);
  }, [selected, graph.edges]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <GitBranch className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-bold tracking-tight">Service Map</h1>
            <p className="text-[11px] text-muted-foreground">
              {nodeIds.length} services · {(graph.edges || []).length} dependencies
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border bg-muted/20 p-[2px]">
            {TIME_OPTIONS.map(o => (
              <button key={o.value} onClick={() => setTimeRange(o.value)}
                className={cn("px-2.5 py-[3px] rounded text-[10px] font-semibold transition-all",
                  timeRange === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground/60 hover:text-muted-foreground")}>
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={() => { setZoom(z => Math.min(z + 0.2, 2.5)); }}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
            <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => { setZoom(z => Math.max(z - 0.2, 0.4)); }}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
            <ZoomOut className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
            <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={fetchGraph}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-muted/30">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Graph Canvas */}
        <div className="flex-1 relative bg-muted/10 overflow-hidden cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40 text-sm">
              Building service map...
            </div>
          ) : nodeIds.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <GitBranch className="h-12 w-12 text-muted-foreground/15 mb-4" />
              <p className="text-sm font-semibold text-muted-foreground">No trace data available</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Start the agent to generate trace data</p>
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="w-full h-full select-none"
              style={{ cursor: "inherit" }}
            >
              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                {/* Edges */}
                {(graph.edges || []).map((edge: any, i: number) => {
                  const from = layout[edge.caller];
                  const to = layout[edge.callee];
                  if (!from || !to) return null;
                  const isSelected = selected === edge.caller || selected === edge.callee;
                  const thickness = 1 + (edge.calls / maxCalls) * 4;
                  const color = edge.error_rate > 5 ? "#ef4444" : isSelected ? "#3b82f6" : "hsl(var(--muted-foreground))";
                  return (
                    <Arrow key={i}
                      x1={from.x} y1={from.y}
                      x2={to.x} y2={to.y}
                      color={color}
                      width={isSelected ? thickness + 1 : thickness}
                    />
                  );
                })}

                {/* Nodes */}
                {nodeIds.map(nodeId => {
                  const pos = layout[nodeId];
                  if (!pos) return null;
                  const stats = nodeStats[nodeId];
                  const color = serviceColor(nodeId);
                  const isSelected = selected === nodeId;
                  const errRate = stats?.error_rate || 0;
                  const badgeColor = errorBadgeColor(errRate);

                  return (
                    <g key={nodeId} transform={`translate(${pos.x}, ${pos.y})`}
                      onClick={() => setSelected(selected === nodeId ? null : nodeId)}
                      style={{ cursor: "pointer" }}>
                      {/* Selection ring */}
                      {isSelected && (
                        <circle r={30} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.4} />
                      )}
                      {/* Node circle */}
                      <circle r={22} fill={`${color}22`} stroke={color} strokeWidth={isSelected ? 2 : 1.5} />
                      {/* Error indicator */}
                      {errRate > 1 && (
                        <circle r={6} fill={badgeColor} cx={16} cy={-16} />
                      )}
                      {/* Label */}
                      <text y={35} textAnchor="middle" fontSize={9} fill="hsl(var(--foreground))"
                        fontFamily="monospace" fontWeight={isSelected ? "bold" : "normal"}>
                        {nodeId.length > 16 ? nodeId.substring(0, 14) + "…" : nodeId}
                      </text>
                      {/* Service icon initial */}
                      <text textAnchor="middle" dominantBaseline="central" fontSize={11}
                        fill={color} fontWeight="bold" fontFamily="monospace">
                        {nodeId.charAt(0).toUpperCase()}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Zoom indicator */}
          <div className="absolute bottom-3 right-3 text-[10px] text-muted-foreground/40 font-mono bg-card/80 px-2 py-1 rounded border border-border">
            {Math.round(zoom * 100)}%
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-card/90 border border-border rounded-lg px-3 py-2 space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Legend</p>
            {[
              { color: "#22c55e", label: "Healthy (<1% errors)" },
              { color: "#eab308", label: "Warning (1-5% errors)" },
              { color: "#ef4444", label: "Degraded (>5% errors)" },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                <span className="text-[9px] text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Side panel - selected node detail */}
        {selected && (
          <div className="w-72 border-l border-border bg-card overflow-y-auto shrink-0">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full" style={{ background: serviceColor(selected) }} />
                <span className="font-mono text-[13px] font-bold">{selected}</span>
              </div>
              {nodeStats[selected] && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {[
                    { label: "Requests", value: nodeStats[selected].calls?.toLocaleString() || "—" },
                    { label: "Errors", value: nodeStats[selected].errors?.toLocaleString() || "0" },
                    {
                      label: "Error Rate", value: `${(nodeStats[selected].error_rate || 0).toFixed(1)}%`,
                      color: errorBadgeColor(nodeStats[selected].error_rate || 0),
                    },
                    { label: "Status", value: (nodeStats[selected].error_rate || 0) > 5 ? "Degraded" : "Healthy" },
                  ].map(item => (
                    <div key={item.label} className="bg-muted/20 rounded-lg p-2">
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{item.label}</div>
                      <div className="text-[13px] font-bold tabular-nums mt-0.5" style={{ color: item.color }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Connections */}
            <div className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Connections ({selectedEdges.length})
              </p>
              {selectedEdges.length === 0 ? (
                <p className="text-xs text-muted-foreground/50">No direct connections</p>
              ) : (
                <div className="space-y-2">
                  {selectedEdges.map((edge: any, i: number) => {
                    const isCaller = edge.caller === selected;
                    const peer = isCaller ? edge.callee : edge.caller;
                    return (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: serviceColor(peer) }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-muted-foreground">{isCaller ? "→" : "←"}</span>
                            <span className="font-mono text-[11px] font-semibold truncate">{peer}</span>
                          </div>
                          <div className="text-[9px] text-muted-foreground">
                            {edge.calls?.toLocaleString()} calls · {(edge.error_rate || 0).toFixed(1)}% errors
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
