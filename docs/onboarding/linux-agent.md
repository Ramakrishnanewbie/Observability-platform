# Onboarding: Linux Agent (on-prem)

Install the Observo agent on any Linux host to collect CPU, memory, disk, network, process, and log metrics.

---

## Table of Contents

- [What gets collected](#what-gets-collected)
- [Prerequisites](#prerequisites)
- [Step 1 — Generate an API key](#step-1--generate-an-api-key)
- [Step 2 — Install the agent](#step-2--install-the-agent)
  - [Option A — One-line installer](#option-a--one-line-installer)
  - [Option B — Docker](#option-b--docker)
  - [Option C — Manual binary](#option-c--manual-binary)
- [Step 3 — Verify the agent appears in Observo](#step-3--verify-the-agent-appears-in-observo)
- [Configuration reference](#configuration-reference)
- [Running as a systemd service](#running-as-a-systemd-service)
- [Troubleshooting](#troubleshooting)

---

## What gets collected

The agent sends the following every 15 seconds:

| Category | Metrics |
|----------|---------|
| CPU | Usage %, per-core, idle, iowait, system, user |
| Memory | Used, available, total, swap |
| Disk | Used %, read/write bytes, IOPS per mount |
| Network | Bytes in/out, packets in/out, errors per interface |
| Processes | Top processes by CPU and memory (name, PID, RSS) |
| Load | 1m / 5m / 15m load averages |
| Uptime | System uptime |

---

## Prerequisites

- Linux (any modern distro — Ubuntu 20.04+, Debian 11+, RHEL 8+, CentOS 8+, Amazon Linux 2)
- Outbound TCP access to the Observo server on port `8080` (or whichever port you configured)
- `curl` for the one-line installer, or Docker

---

## Step 1 — Generate an API key

1. Open Observo → **Settings → API Keys**
2. Click **Create Key**
3. Enter a name like `prod-web-01`
4. Copy the generated key (shown only once) — format: `obs_live_<48 chars>`

---

## Step 2 — Install the agent

### Option A — One-line installer

Run this on the target host, replacing `<SERVER_URL>` and `<API_KEY>`:

```bash
curl -fsSL http://<YOUR_OBSERVO_HOST>:8080/install.sh | \
  OBSERVO_SERVER_URL=http://<YOUR_OBSERVO_HOST>:8080 \
  OBSERVO_API_KEY=obs_live_... \
  bash
```

The installer:
- Downloads the latest `observo-agent` binary for your architecture
- Installs it to `/usr/local/bin/observo-agent`
- Creates a systemd service `observo-agent`
- Starts the service and enables it on boot

### Option B — Docker

```bash
docker run -d \
  --name observo-agent \
  --network host \
  --pid host \
  --privileged \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -v /:/rootfs:ro \
  -e OBSERVO_SERVER_URL=http://<YOUR_OBSERVO_HOST>:8080 \
  -e OBSERVO_API_KEY=obs_live_... \
  -e OBSERVO_TAGS="env=production,region=us-east" \
  ghcr.io/your-org/observo-agent:latest
```

`--network host` is required so the agent can see all network interfaces.

### Option C — Manual binary

1. Download the binary from the Observo releases page or build from source:

```bash
git clone <repo-url>
cd observability-platform
go build -o observo-agent ./cmd/agent
```

2. Copy to the target host:

```bash
scp observo-agent user@host:/usr/local/bin/observo-agent
chmod +x /usr/local/bin/observo-agent
```

3. Run it:

```bash
OBSERVO_SERVER_URL=http://<YOUR_OBSERVO_HOST>:8080 \
OBSERVO_API_KEY=obs_live_... \
/usr/local/bin/observo-agent
```

---

## Step 3 — Verify the agent appears in Observo

1. Open Observo → **Infrastructure**
2. The host should appear within 30 seconds with a green status indicator
3. Click the host to see live CPU, memory, disk, and network graphs

---

## Configuration reference

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSERVO_SERVER_URL` | `http://localhost:8080` | Observo backend URL |
| `OBSERVO_API_KEY` | *(empty)* | API key for authentication |
| `OBSERVO_HOSTNAME` | OS hostname | Override the reported hostname |
| `OBSERVO_TAGS` | *(empty)* | Comma-separated key=value tags, e.g. `env=prod,region=us-east` |
| `OBSERVO_INTERVAL` | `15` | Collection interval in seconds |

---

## Running as a systemd service

If you installed manually, create a systemd unit:

```ini
# /etc/systemd/system/observo-agent.service
[Unit]
Description=Observo Agent
After=network.target

[Service]
Type=simple
Environment=OBSERVO_SERVER_URL=http://your-observo-host:8080
Environment=OBSERVO_API_KEY=obs_live_...
Environment=OBSERVO_TAGS=env=production
ExecStart=/usr/local/bin/observo-agent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now observo-agent
sudo systemctl status observo-agent
```

---

## Troubleshooting

### Host does not appear in Infrastructure

Check the agent is running and can reach the server:

```bash
systemctl status observo-agent
journalctl -u observo-agent -f

# Test connectivity manually
curl -X POST http://<OBSERVO_HOST>:8080/v1/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: obs_live_..." \
  -d '{"hostname":"test"}'
```

### `unauthorized` error in agent logs

The API key is invalid or not set. Re-generate the key in Settings → API Keys and update the environment variable.

### `REQUIRE_AUTH=false` — do I still need an API key?

No. If the server was started with `REQUIRE_AUTH=false`, the `OBSERVO_API_KEY` variable can be left blank and all requests are accepted.

### High CPU usage from the agent

Reduce the collection frequency:

```bash
OBSERVO_INTERVAL=60 /usr/local/bin/observo-agent
```
