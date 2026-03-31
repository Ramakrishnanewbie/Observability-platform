// ─── Dashboard Types ───

export interface LayoutItem {
  i: string;    // widget ID
  x: number;    // left position in pixels
  y: number;    // top position in pixels
  w: number;    // width in pixels
  h: number;    // height in pixels
}

export type WidgetType =
  | "kpi"
  | "area_chart"
  | "line_chart"
  | "bar_chart"
  | "log_stream"
  | "metric_table"
  | "trace_list"
  | "alert_status"
  | "host_map"
  | "text";

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  metric?: string;           // for charts: "cpu.usage_percent", etc.
  timeRange?: number;         // minutes
  host?: string;              // filter by host
  severity?: string;          // for log widgets
  refreshInterval?: number;   // ms
  thresholds?: { warn: number; critical: number };
  color?: string;
  description?: string;
}

export interface Dashboard {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  layout: LayoutItem[];
  widgets: WidgetConfig[];
  is_default?: boolean;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

// ─── Widget Type Definitions ───

export interface ChartTypeDefinition {
  type: WidgetType;
  label: string;
  description: string;
  icon: string;
  category: "kpi" | "chart" | "data" | "status";
  defaultSize: { w: number; h: number };
}

export const WIDGET_TYPES: ChartTypeDefinition[] = [
  {
    type: "kpi",
    label: "KPI Card",
    description: "Single metric with trend indicator",
    icon: "Hash",
    category: "kpi",
    defaultSize: { w: 280, h: 140 },
  },
  {
    type: "area_chart",
    label: "Area Chart",
    description: "Time-series with filled area",
    icon: "AreaChart",
    category: "chart",
    defaultSize: { w: 560, h: 300 },
  },
  {
    type: "line_chart",
    label: "Line Chart",
    description: "Time-series line graph",
    icon: "TrendingUp",
    category: "chart",
    defaultSize: { w: 560, h: 300 },
  },
  {
    type: "bar_chart",
    label: "Bar Chart",
    description: "Comparison bars",
    icon: "BarChart3",
    category: "chart",
    defaultSize: { w: 560, h: 300 },
  },
  {
    type: "metric_table",
    label: "Metric Table",
    description: "Latest metrics in table format",
    icon: "Table",
    category: "data",
    defaultSize: { w: 560, h: 280 },
  },
  {
    type: "log_stream",
    label: "Log Stream",
    description: "Live log tail with filtering",
    icon: "ScrollText",
    category: "data",
    defaultSize: { w: 800, h: 320 },
  },
  {
    type: "trace_list",
    label: "Recent Traces",
    description: "Latest distributed traces",
    icon: "Network",
    category: "data",
    defaultSize: { w: 560, h: 280 },
  },
  {
    type: "alert_status",
    label: "Alert Status",
    description: "Firing alerts overview",
    icon: "Bell",
    category: "status",
    defaultSize: { w: 300, h: 200 },
  },
  {
    type: "host_map",
    label: "Host Map",
    description: "Infrastructure host overview",
    icon: "Server",
    category: "status",
    defaultSize: { w: 500, h: 280 },
  },
  {
    type: "text",
    label: "Text / Markdown",
    description: "Notes, titles, and descriptions",
    icon: "Type",
    category: "kpi",
    defaultSize: { w: 280, h: 120 },
  },
];

// ─── Available metrics for dropdown ───

export const AVAILABLE_METRICS = [
  { value: "cpu.usage_percent", label: "CPU Usage %" },
  { value: "memory.usage_percent", label: "Memory Usage %" },
  { value: "memory.used_bytes", label: "Memory Used (bytes)" },
  { value: "memory.total_bytes", label: "Memory Total (bytes)" },
  { value: "disk.usage_percent", label: "Disk Usage %" },
];
