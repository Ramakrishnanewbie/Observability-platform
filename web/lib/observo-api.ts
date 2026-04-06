// Observo Go backend API client — v3.0
// All requests go through /api/observo proxy route (Next.js server-side → Go backend)
const API_BASE = "/api/observo";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const observoApi = {
  // ── Metrics ──
  getMetrics: (host?: string) =>
    apiFetch<any[]>(`/v1/query${host ? `?host=${host}` : ""}`),
  getTimeseries: (metric: string, minutes = 10, host?: string) =>
    apiFetch<any[]>(
      `/v1/query/timeseries?metric=${metric}&minutes=${minutes}${host ? `&host=${host}` : ""}`
    ),
  getLatest: (host?: string) =>
    apiFetch<any[]>(`/v1/query/latest${host ? `?host=${host}` : ""}`),
  getHosts: () => apiFetch<string[]>("/v1/hosts"),
  getMetricNames: () => apiFetch<string[]>("/v1/metrics/names"),

  // ── Logs ──
  getLogs: (params?: string) => apiFetch<any[]>(`/v1/logs?${params || "limit=200"}`),
  getLogStats: () => apiFetch<any[]>("/v1/logs/stats"),
  getLogSources: () => apiFetch<any[]>("/v1/logs/sources"),
  getLogRate: (minutes = 60) => apiFetch<any[]>(`/v1/logs/rate?minutes=${minutes}`),

  // ── Traces ──
  getTraces: (params?: string) =>
    apiFetch<any[]>(`/v1/traces?${params || "minutes=30&limit=50"}`),
  getTraceDetail: (id: string) => apiFetch<any[]>(`/v1/traces/${id}`),
  getServices: () => apiFetch<string[]>("/v1/traces/services"),
  getServiceGraph: (minutes = 60) =>
    apiFetch<{ nodes: any[]; edges: any[] }>(`/v1/traces/graph?minutes=${minutes}`),

  // ── APM ──
  getAPMServices: (minutes = 60) =>
    apiFetch<any[]>(`/v1/apm/services?minutes=${minutes}`),
  getAPMServiceTimeseries: (service: string, minutes = 60) =>
    apiFetch<any[]>(`/v1/apm/services/${encodeURIComponent(service)}/timeseries?minutes=${minutes}`),

  // ── Processes ──
  getProcesses: (host?: string) =>
    apiFetch<any[]>(`/v1/processes${host ? `?host=${encodeURIComponent(host)}` : ""}`),

  // ── Network ──
  getNetworkLatest: (host?: string) =>
    apiFetch<any[]>(`/v1/network/latest${host ? `?host=${encodeURIComponent(host)}` : ""}`),
  getNetworkTimeseries: (host?: string, minutes = 10) =>
    apiFetch<any[]>(`/v1/network?minutes=${minutes}${host ? `&host=${encodeURIComponent(host)}` : ""}`),

  // ── Agents ──
  getAgents: () => apiFetch<any[]>("/v1/agents"),

  // ── Anomaly Detection ──
  getAnomalies: (minutes = 60) =>
    apiFetch<any[]>(`/v1/anomalies?minutes=${minutes}`),

  // ── Platform Stats ──
  getPlatformStats: () => apiFetch<any>("/v1/stats"),

  // ── Alerts ──
  getAlertRules: () => apiFetch<any[]>("/v1/alerts/rules"),
  createAlertRule: (rule: any) =>
    apiFetch<any>("/v1/alerts/rules", { method: "POST", body: JSON.stringify(rule) }),
  deleteAlertRule: (id: string) =>
    apiFetch<any>(`/v1/alerts/rules?id=${id}`, { method: "DELETE" }),
  getFiringAlerts: () => apiFetch<any[]>("/v1/alerts/firing"),
  getAlertHistory: (minutes = 60) =>
    apiFetch<any[]>(`/v1/alerts/history?minutes=${minutes}`),
  acknowledgeAlert: (alertId: string) =>
    apiFetch<any>("/v1/alerts/acknowledge", { method: "POST", body: JSON.stringify({ alert_id: alertId }) }),

  // ── Notification Channels ──
  getNotifChannels: () => apiFetch<any[]>("/v1/notifications/channels"),
  createNotifChannel: (ch: any) =>
    apiFetch<any>("/v1/notifications/channels", { method: "POST", body: JSON.stringify(ch) }),
  deleteNotifChannel: (id: string) =>
    apiFetch<any>(`/v1/notifications/channels?id=${id}`, { method: "DELETE" }),
  testNotifChannel: (ch: any) =>
    apiFetch<any>("/v1/notifications/test", { method: "POST", body: JSON.stringify(ch) }),

  // ── Data Sources (cloud integrations + on-prem) ──
  getDataSources: () => apiFetch<any[]>("/v1/datasources"),
  createDataSource: (ds: any) =>
    apiFetch<any>("/v1/datasources", { method: "POST", body: JSON.stringify(ds) }),
  deleteDataSource: (id: string) =>
    apiFetch<any>(`/v1/datasources?id=${id}`, { method: "DELETE" }),
  testDataSource: (ds: any) =>
    ds.id
      ? apiFetch<any>(`/v1/datasources/test?id=${ds.id}`, { method: "POST" })
      : apiFetch<any>("/v1/datasources/test", { method: "POST", body: JSON.stringify(ds) }),

  // ── API Keys ──
  getAPIKeys: () => apiFetch<any[]>("/v1/apikeys"),
  createAPIKey: (req: { name: string; org_id?: string }) =>
    apiFetch<any>("/v1/apikeys", { method: "POST", body: JSON.stringify(req) }),
  revokeAPIKey: (id: string) =>
    apiFetch<any>(`/v1/apikeys?id=${id}`, { method: "DELETE" }),

  // ── Health ──
  getHealth: () => apiFetch<{ status: string; version: string }>("/health"),
};
