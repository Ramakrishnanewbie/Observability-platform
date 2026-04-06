# Onboarding: Windows Agent (on-prem)

Install the Observo agent on Windows Server or Windows Desktop to collect system metrics.

---

## Table of Contents

- [What gets collected](#what-gets-collected)
- [Prerequisites](#prerequisites)
- [Step 1 — Generate an API key](#step-1--generate-an-api-key)
- [Step 2 — Install the agent](#step-2--install-the-agent)
  - [Option A — PowerShell one-line installer](#option-a--powershell-one-line-installer)
  - [Option B — Manual binary](#option-b--manual-binary)
- [Step 3 — Verify the agent appears in Observo](#step-3--verify-the-agent-appears-in-observo)
- [Configuration reference](#configuration-reference)
- [Running as a Windows Service](#running-as-a-windows-service)
- [Troubleshooting](#troubleshooting)

---

## What gets collected

| Category | Metrics |
|----------|---------|
| CPU | Usage %, per-core utilisation |
| Memory | Used, available, total, paged pool |
| Disk | Used %, read/write bytes per volume |
| Network | Bytes in/out per adapter |
| Processes | Top processes by CPU and memory |
| Load | System uptime |

---

## Prerequisites

- Windows Server 2016+ or Windows 10+
- PowerShell 5.1+ (built-in on all supported versions)
- Outbound TCP access to the Observo server on port `8080`

---

## Step 1 — Generate an API key

1. Open Observo → **Settings → API Keys**
2. Click **Create Key**
3. Enter a name like `prod-win-server-01`
4. Copy the generated key — format: `obs_live_<48 chars>`

---

## Step 2 — Install the agent

### Option A — PowerShell one-line installer

Open PowerShell **as Administrator** and run:

```powershell
$env:OBSERVO_SERVER_URL = "http://<YOUR_OBSERVO_HOST>:8080"
$env:OBSERVO_API_KEY    = "obs_live_..."
Invoke-Expression (Invoke-WebRequest "http://<YOUR_OBSERVO_HOST>:8080/install.ps1").Content
```

The installer:
- Downloads `observo-agent.exe` for Windows amd64
- Installs it to `C:\Program Files\Observo\`
- Registers it as a Windows Service named `ObservoAgent`
- Starts the service

### Option B — Manual binary

1. Build from source on a Windows machine:

```powershell
git clone <repo-url>
cd observability-platform
go build -o observo-agent.exe .\cmd\agent\
```

2. Copy `observo-agent.exe` to the target machine at `C:\Program Files\Observo\observo-agent.exe`

3. Set environment variables and run:

```powershell
$env:OBSERVO_SERVER_URL = "http://<YOUR_OBSERVO_HOST>:8080"
$env:OBSERVO_API_KEY    = "obs_live_..."
& "C:\Program Files\Observo\observo-agent.exe"
```

---

## Step 3 — Verify the agent appears in Observo

1. Open Observo → **Infrastructure**
2. The Windows host should appear within 30 seconds
3. Click it to see CPU, memory, disk, and network graphs

---

## Configuration reference

Set these as system environment variables or in the service configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSERVO_SERVER_URL` | `http://localhost:8080` | Observo backend URL |
| `OBSERVO_API_KEY` | *(empty)* | API key for authentication |
| `OBSERVO_HOSTNAME` | Computer name | Override the reported hostname |
| `OBSERVO_TAGS` | *(empty)* | Comma-separated key=value tags |
| `OBSERVO_INTERVAL` | `15` | Collection interval in seconds |

---

## Running as a Windows Service

### Using NSSM (recommended)

Download [NSSM](https://nssm.cc) and run:

```powershell
nssm install ObservoAgent "C:\Program Files\Observo\observo-agent.exe"
nssm set ObservoAgent AppEnvironmentExtra `
  "OBSERVO_SERVER_URL=http://your-host:8080" `
  "OBSERVO_API_KEY=obs_live_..."
nssm start ObservoAgent
```

### Using sc.exe (built-in)

```powershell
sc.exe create ObservoAgent `
  binPath= "C:\Program Files\Observo\observo-agent.exe" `
  start= auto

sc.exe start ObservoAgent
```

To set environment variables for the service, use the registry:

```powershell
$path = "HKLM:\SYSTEM\CurrentControlSet\Services\ObservoAgent"
Set-ItemProperty $path -Name Environment -Value @(
    "OBSERVO_SERVER_URL=http://your-host:8080",
    "OBSERVO_API_KEY=obs_live_..."
)
Restart-Service ObservoAgent
```

---

## Troubleshooting

### Service fails to start

Check the Windows Event Viewer → **Windows Logs → Application** for errors from `ObservoAgent`.

### Host does not appear in Infrastructure

Test connectivity from the Windows host:

```powershell
Invoke-RestMethod -Uri "http://<OBSERVO_HOST>:8080/health"
```

If this fails, check Windows Firewall rules allowing outbound TCP on port 8080.

### `Access Denied` when running the agent

The agent reads system metrics which require elevated privileges. Run as Administrator or configure the service to run under the Local System account.

### WMI errors in logs

Some memory and disk metrics use WMI. Ensure the WMI service is running:

```powershell
Get-Service Winmgmt | Start-Service
```
