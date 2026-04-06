# Observo — Self-Hosted Observability Platform

A full-stack observability platform with metrics, logs, traces, alerting, and multi-cloud integrations. Deploy on your own infrastructure and connect any cloud provider or on-prem host.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Self-Hosting](#self-hosting)
- [Onboarding Guides](#onboarding-guides)
  - [GCP Cloud Monitoring](docs/onboarding/gcp.md)
  - [AWS CloudWatch](docs/onboarding/aws.md)
  - [Azure Monitor](docs/onboarding/azure.md)
  - [Kubernetes](docs/onboarding/kubernetes.md)
  - [Prometheus](docs/onboarding/prometheus.md)
  - [Linux Agent (on-prem)](docs/onboarding/linux-agent.md)
  - [Windows Agent (on-prem)](docs/onboarding/windows-agent.md)
- [Configuration Reference](#configuration-reference)
- [API Keys](#api-keys)
- [OpenTelemetry (OTLP)](#opentelemetry-otlp)

---

## Overview

Observo collects and visualises:

| Signal | Sources |
|--------|---------|
| Metrics | Agents, CloudWatch, GCP Monitoring, Azure Monitor, Prometheus, OTLP |
| Logs | Agents, OTLP |
| Traces / Spans | OTLP, auto-instrumented apps |
| Alerts | Threshold rules on any metric |
| Service Map | Derived from trace data |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│              Next.js frontend  (port 3000)              │
└───────────────────────┬─────────────────────────────────┘
                        │ /api/observo/* proxy
┌───────────────────────▼─────────────────────────────────┐
│               Go backend server (port 8080)             │
│  REST API · Alert engine · Cloud pollers · OTLP ingest  │
└──────┬──────────────────────────┬───────────────────────┘
       │                          │
┌──────▼──────┐        ┌──────────▼──────────┐
│ TimescaleDB │        │  Cloud APIs / Agents │
│ (PostgreSQL)│        │  AWS · GCP · Azure   │
│  port 5432  │        │  K8s · Prometheus    │
└─────────────┘        └─────────────────────┘
```

**Components**

| Component | Language | Purpose |
|-----------|----------|---------|
| `cmd/server` | Go | REST API, alert engine, cloud pollers, OTLP receiver |
| `cmd/agent` | Go | Lightweight host metrics + log collector |
| `web/` | Next.js 15 | Dashboard, alerts, logs, traces, settings UI |
| TimescaleDB | PostgreSQL | Time-series metric and event storage |

---

## Self-Hosting

See the full guide: **[docs/self-hosting.md](docs/self-hosting.md)**

**Quick start with Docker Compose:**

```bash
git clone <repo>
cd observability-platform
docker compose up -d
```

Open `http://localhost:3000`.

---

## Onboarding Guides

Connect data sources from the **Settings → Data Sources** panel in the UI, or follow the step-by-step guides below.

| Source | Guide |
|--------|-------|
| GCP Cloud Monitoring | [docs/onboarding/gcp.md](docs/onboarding/gcp.md) |
| AWS CloudWatch | [docs/onboarding/aws.md](docs/onboarding/aws.md) |
| Azure Monitor | [docs/onboarding/azure.md](docs/onboarding/azure.md) |
| Kubernetes | [docs/onboarding/kubernetes.md](docs/onboarding/kubernetes.md) |
| Prometheus | [docs/onboarding/prometheus.md](docs/onboarding/prometheus.md) |
| Linux host (on-prem) | [docs/onboarding/linux-agent.md](docs/onboarding/linux-agent.md) |
| Windows host (on-prem) | [docs/onboarding/windows-agent.md](docs/onboarding/windows-agent.md) |

---

## Configuration Reference

All server configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | TimescaleDB hostname |
| `POSTGRES_PORT` | `5432` | TimescaleDB port |
| `POSTGRES_DB` | `observo` | Database name |
| `POSTGRES_USER` | `observo` | Database user |
| `POSTGRES_PASS` | `observo` | Database password |
| `PORT` | `8080` | Backend HTTP port |
| `REQUIRE_AUTH` | `false` | Set `true` to require API key on all agent endpoints |

Frontend build args (Next.js):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (for auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_OBSERVO_API_URL` | Backend URL visible to the browser |
| `OBSERVO_API_URL` | Backend URL used by the Next.js server-side proxy |

---

## API Keys

API keys authenticate agent-to-server communication and can be generated in **Settings → API Keys**.

Format: `obs_live_<48 hex chars>`

Usage:

```bash
# HTTP header
curl -H "X-API-Key: obs_live_..." http://localhost:8080/v1/metrics

# Environment variable for the agent
OBSERVO_API_KEY=obs_live_... ./observo-agent
```

---

## OpenTelemetry (OTLP)

Any app with an OpenTelemetry SDK can send telemetry directly to Observo:

| Endpoint | Signal |
|----------|--------|
| `POST /v1/otlp/v1/traces` | Traces (JSON) |
| `POST /v1/otlp/v1/metrics` | Metrics (JSON) |
| `POST /v1/otlp/v1/logs` | Logs (JSON) |

Set the OTLP exporter endpoint in your app:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8080/v1/otlp
```

Example with Node.js:

```js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:8080/v1/otlp/v1/traces',
  }),
});
sdk.start();
```
