# Onboarding: Prometheus

Connect an existing Prometheus instance to Observo to pull its metrics into the unified dashboard.

---

## Table of Contents

- [What gets collected](#what-gets-collected)
- [Prerequisites](#prerequisites)
- [Step 1 — Confirm Prometheus is reachable](#step-1--confirm-prometheus-is-reachable)
- [Step 2 — (Optional) Create an auth token](#step-2--optional-create-an-auth-token)
- [Step 3 — Add the data source in Observo](#step-3--add-the-data-source-in-observo)
- [Metrics collected](#metrics-collected)
- [Troubleshooting](#troubleshooting)

---

## What gets collected

Observo scrapes the Prometheus HTTP API (`/api/v1/query`) every 60 seconds and maps common `node_exporter` metrics to its internal schema:

| Prometheus query | Observo metric |
|-----------------|----------------|
| `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100` | `node.cpu_usage_percent` |
| `node_memory_MemAvailable_bytes` | `node.memory_available_bytes` |
| `node_memory_MemTotal_bytes` | `node.memory_total_bytes` |
| `node_filesystem_avail_bytes{mountpoint="/"}` | `node.disk_free_bytes` |
| `rate(node_network_receive_bytes_total[5m])` | `node.network_recv_bytes_rate` |
| `rate(node_network_transmit_bytes_total[5m])` | `node.network_sent_bytes_rate` |
| `node_load1` | `node.load1` |
| `process_resident_memory_bytes` | `process.memory_bytes` |

These queries assume [node_exporter](https://github.com/prometheus/node_exporter) is configured as a Prometheus scrape target.

---

## Prerequisites

- A running Prometheus server accessible from the Observo server (HTTP or HTTPS)
- `node_exporter` deployed on the hosts you want to monitor (for the default metric set)

---

## Step 1 — Confirm Prometheus is reachable

From the machine running Observo, test connectivity:

```bash
curl http://your-prometheus-host:9090/-/ready
# Expected: Prometheus Server is Ready.
```

---

## Step 2 — (Optional) Create an auth token

If your Prometheus is behind an authentication proxy (e.g. with `--web.enable-remote-write-receiver` and basic auth, or Grafana Agent), configure a Bearer token.

For plain Prometheus with no auth, leave the token field blank.

---

## Step 3 — Add the data source in Observo

1. Open Observo → **Settings → Data Sources**
2. Click **Add Source**
3. Select **Prometheus**
4. Fill in the fields:

| Field | Value |
|-------|-------|
| **Name** | A display name, e.g. `Production Prometheus` |
| **Prometheus URL** | Base URL without trailing slash, e.g. `http://prometheus.internal:9090` |
| **Bearer Token** | (Optional) Auth token if your Prometheus is behind a proxy |

5. Click **Add & Test**

---

## Troubleshooting

### `Cannot reach Prometheus`

- The Prometheus URL must be reachable from the Observo server (not just the browser)
- Include the port: `http://10.0.0.5:9090`
- No trailing slash

### Metrics are empty

- Verify `node_exporter` is running on target hosts and Prometheus is scraping them:
  ```
  http://your-prometheus:9090/targets
  ```
- Check that the metric names match — if you use custom recording rules or a different exporter, the default queries may not match

### Authentication failures

If Prometheus is behind basic auth, wrap it with a reverse proxy that accepts Bearer tokens, or use Observo's OTLP receiver and push metrics from Prometheus using `remote_write`.

### Using `remote_write` instead of pull

For Prometheus instances not directly reachable from Observo, configure `remote_write` in `prometheus.yml` to push to the OTLP endpoint:

```yaml
remote_write:
  - url: http://observo-server:8080/v1/otlp/v1/metrics
```
