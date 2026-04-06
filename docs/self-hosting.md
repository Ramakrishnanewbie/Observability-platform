# Self-Hosting Guide

This guide covers running the full Observo stack on your own infrastructure.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Option 1 — Docker Compose (recommended)](#option-1--docker-compose-recommended)
- [Option 2 — Manual / bare-metal](#option-2--manual--bare-metal)
- [Authentication setup (Supabase)](#authentication-setup-supabase)
- [Production checklist](#production-checklist)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker | 24+ | For Docker Compose option |
| Docker Compose | v2 | Included in Docker Desktop |
| Go | 1.21+ | Only needed for manual builds |
| Node.js | 20+ | Only needed for manual builds |
| PostgreSQL + TimescaleDB | PG 16 | Managed automatically by Docker |

---

## Option 1 — Docker Compose (recommended)

### 1. Clone the repository

```bash
git clone <repo-url>
cd observability-platform
```

### 2. Configure environment

Edit `docker-compose.yml` and set your own values for these fields in the `web` service's `args` section:

```yaml
args:
  NEXT_PUBLIC_SUPABASE_URL: https://<your-project>.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY: <your-anon-key>
  NEXT_PUBLIC_OBSERVO_API_URL: http://localhost:8080
```

If you are not using Supabase auth (i.e. `REQUIRE_AUTH: "false"`), these can be left as placeholders and the app will still function for viewing data.

### 3. Start the stack

```bash
docker compose up -d
```

This starts four containers:

| Container | Port | Purpose |
|-----------|------|---------|
| `observo-timescaledb` | 5432 | PostgreSQL + TimescaleDB |
| `observo-server` | 8080 | Go backend API |
| `observo-agent` | — | Host metrics agent |
| `observo-web` | 3000 | Next.js frontend |

### 4. Open the UI

Navigate to `http://localhost:3000`.

### 5. Stopping

```bash
docker compose down          # stop containers, keep data
docker compose down -v       # stop containers and wipe all data
```

---

## Option 2 — Manual / bare-metal

### 1. Start TimescaleDB

```bash
docker run -d \
  --name observo-timescaledb \
  -e POSTGRES_DB=observo \
  -e POSTGRES_USER=observo \
  -e POSTGRES_PASSWORD=observo \
  -p 5432:5432 \
  timescale/timescaledb:latest-pg16
```

Or point to an existing PostgreSQL 14+ instance with the TimescaleDB extension installed:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

### 2. Build and run the server

```bash
cd cmd/server
go build -o observo-server .
POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 \
POSTGRES_DB=observo \
POSTGRES_USER=observo \
POSTGRES_PASS=observo \
PORT=8080 \
./observo-server
```

### 3. Build and run the frontend

```bash
cd web
cp .env.local.example .env.local   # fill in Supabase values
npm install
npm run build
npm start
```

Or for development:

```bash
npm run dev
```

### 4. Run an agent on each host (optional)

See [Linux Agent](onboarding/linux-agent.md) or [Windows Agent](onboarding/windows-agent.md).

---

## Authentication setup (Supabase)

Observo uses [Supabase](https://supabase.com) for user authentication. You can use the free tier.

### Steps

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Copy your **Project URL** and **anon public key** from *Settings → API*
3. Set these as environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. In Supabase → *Authentication → URL Configuration*, add your domain to **Redirect URLs**:
   ```
   http://localhost:3000/auth/callback
   https://your-domain.com/auth/callback
   ```
5. Enable the auth providers you want (Email, Google, GitHub) in *Authentication → Providers*

### Disabling auth (local dev / internal use)

Set `REQUIRE_AUTH=false` in the server environment. The backend will accept all requests without authentication. The UI will still render the auth page but you can navigate directly to `/dashboard`.

---

## Production checklist

- [ ] Change all default passwords in `docker-compose.yml` or your environment
- [ ] Put the frontend and backend behind a TLS-terminating reverse proxy (nginx, Caddy, Traefik)
- [ ] Set `REQUIRE_AUTH=true` if exposing to the internet
- [ ] Mount a persistent Docker volume for TimescaleDB data (already set up in `docker-compose.yml` as `tsdb-data`)
- [ ] Set resource limits on containers if running alongside other workloads
- [ ] Configure Supabase with your production redirect URLs
- [ ] Rotate the default API key shown in Settings after first login

### Example: nginx reverse proxy

```nginx
server {
    listen 443 ssl;
    server_name observo.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

The server applies schema changes automatically on startup via `CREATE TABLE IF NOT EXISTS`.

---

## Troubleshooting

### `dial tcp: connection refused` on startup

The server starts before TimescaleDB is ready. Docker Compose has a healthcheck on `timescaledb` — if you see this, wait 20-30 seconds and the server will reconnect.

### Frontend shows "Platform Status: Degraded"

The backend API is unreachable. Check:
```bash
docker compose logs server
curl http://localhost:8080/health
```

### Agent shows `unauthorized`

Create an API key in **Settings → API Keys** and set it:
```bash
OBSERVO_API_KEY=obs_live_... ./observo-agent
```

Or set `REQUIRE_AUTH=false` in the server if you are on a trusted network.

### TimescaleDB data not persisting after restart

Ensure the volume is mounted. The `docker-compose.yml` file uses a named volume `tsdb-data`. Check with:
```bash
docker volume ls | grep tsdb
```
