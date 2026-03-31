// Observo Go backend API client
const API_BASE = process.env.NEXT_PUBLIC_OBSERVO_API_URL || "http://localhost:8080";

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

  // ── Logs ──
  getLogs: (params?: string) => apiFetch<any[]>(`/v1/logs?${params || "limit=200"}`),
  getLogStats: () => apiFetch<any[]>("/v1/logs/stats"),

  // ── Traces ──
  getTraces: (params?: string) =>
    apiFetch<any[]>(`/v1/traces?${params || "minutes=30&limit=50"}`),
  getTraceDetail: (id: string) => apiFetch<any[]>(`/v1/traces/${id}`),
  getServices: () => apiFetch<string[]>("/v1/traces/services"),

  // ── Alerts ──
  getAlertRules: () => apiFetch<any[]>("/v1/alerts/rules"),
  createAlertRule: (rule: any) =>
    apiFetch<any>("/v1/alerts/rules", {
      method: "POST",
      body: JSON.stringify(rule),
    }),
  deleteAlertRule: (id: string) =>
    apiFetch<any>(`/v1/alerts/rules?id=${id}`, { method: "DELETE" }),
  getFiringAlerts: () => apiFetch<any[]>("/v1/alerts/firing"),
  getAlertHistory: (minutes = 60) =>
    apiFetch<any[]>(`/v1/alerts/history?minutes=${minutes}`),

  // ── Health ──
  getHealth: () => apiFetch<{ status: string }>("/health"),
};
