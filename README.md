# Background Worker

Monitors the DataAnnotation projects API on a randomized interval (within a configurable daily window) and sends WhatsApp alerts via WAHA when new paid projects or qualifications with available tasks appear. Jobs, recipients, schedules, and the stored login cookie are all managed from the dashboard UI and persisted in PostgreSQL.

## Quick Start (Local Development)

```bash
# 1. Start WAHA (WhatsApp bridge) — exposes port 3001
docker compose -f waha/docker-compose.yml up -d

# 2. Start Postgres (any local instance works; example with Docker)
docker run -d --name auto-checker-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=auto_checker postgres:16

# 3. Install deps and configure env
npm install
cp .env.local.example .env.local   # fill in the values (see below)

# 4. Run — migrations run automatically on boot
npm run dev
```

**WAHA runs on http://localhost:3001.** Open it to scan the QR code and start your WhatsApp session. Then sign in to the app at http://localhost:3000, open a job, and configure its schedule, recipients, and session cookie from the UI.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `WAHA_URL` | WAHA API base URL (e.g. `http://localhost:3001`) | Yes |
| `WAHA_API_KEY` | WAHA API key | No |
| `WAHA_SESSION` | WAHA session name (default: `default`) | No |
| `HEALTH_CHECK_TOKEN` | Token guarding `GET /api/health`; if unset the endpoint is open | No |
| `JWT_SECRET` | Secret for signing the session JWT (min 32 chars) | Yes |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) — encrypts stored session cookies | Yes |
| `ADMIN_USERNAME` | Login username (default: `admin`) | No |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the login password | Yes |
| `DATAANNOTATION_USE_LOCAL` | Dev only — use a local HTML fixture instead of hitting the live site | No |

Schedule settings (interval range, daily window, timezone offset) are **per-job** and live in the database — edit them from the dashboard, not via env vars.

### Generating secrets

```bash
JWT_SECRET=$(openssl rand -base64 32)        # session signing key
ENCRYPTION_KEY=$(openssl rand -hex 32)        # exactly 64 hex chars
# bcrypt hash for ADMIN_PASSWORD_HASH:
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'your-password'
```

## Deployment (Northflank)

The app and WAHA both deploy to Northflank as containers, backed by a managed Postgres addon. Migrations run automatically on first boot (`instrumentation.ts` → `runMigrations`), so there is no separate migration step.

### 1. PostgreSQL

1. In your Northflank project, add a **PostgreSQL addon**.
2. From the addon's connection details, copy the connection string into the app's `DATABASE_URL`. Prefer the **internal** connection string so traffic stays inside the project network.

### 2. Auto Checker app

1. Create a **Combined service** (build + deploy) from the GitHub repo `bryanbernigen/auto-checker`, branch `main`.
2. Build from the included `Dockerfile` (Next.js standalone output).
3. Expose **port 3000** with a public domain.
4. Set environment variables / secrets:
   - `DATABASE_URL` (from the Postgres addon)
   - `WAHA_URL` (the WAHA service's internal URL — see below)
   - `WAHA_API_KEY`
   - `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD_HASH` (see [Generating secrets](#generating-secrets))
   - `ADMIN_USERNAME` (optional; defaults to `admin`)

### 3. WAHA

1. Add a **Deployment service** from the Docker image `devlikeapro/waha:latest`.
2. Environment: `WAHA_SESSION=default`, `WAHA_SESSION_AUTO_START=true`, `WHATSAPP_DEFAULT_ENGINE=NOWEB`, and a `WAHA_API_KEY`.
3. Attach a **persistent volume** mounted at `/app/.wahaSessions` so the WhatsApp session survives restarts.
4. Expose **port 3000**. Use its internal URL for the app's `WAHA_URL`; optionally expose a public domain to reach the WAHA dashboard.

After WAHA is up, open its dashboard, scan the QR code to link WhatsApp, and confirm the API key.

## Architecture

- **Next.js 16** (App Router, TypeScript) — dashboard UI and API routes
- **PostgreSQL + Drizzle ORM** — jobs, recipients, run history, and encrypted session cookies; migrations applied automatically on boot
- **In-process scheduler** (`lib/scheduler`, started from `instrumentation.ts`) — arms a per-job timer at a random interval within each job's daily window; no external cron needed
- **WAHA** (Docker) — sends the WhatsApp messages

## Monitoring (is it still running?)

The app exposes a health endpoint so you can be alerted when monitoring silently
stops — including the most common failure, the **WAHA WhatsApp session expiring**
(the WAHA process keeps running but can no longer send).

**`GET /api/health`** (also responds to `HEAD`) returns an HTTP status
(`200` healthy, `503` unhealthy) so any uptime monitor can act on it — `GET`
includes a JSON body, `HEAD` is status-only. It checks:

- **database** — a `SELECT 1` succeeds
- **scheduler** — the in-process scheduler is started (and how many timers are armed)
- **waha** — `GET /api/sessions/{WAHA_SESSION}` reports `status: WORKING`; anything
  else (`SCAN_QR_CODE`, `STOPPED`, `FAILED`) means it **can't send** → `degraded`
- **cookie** — the DataAnnotation cookie isn't rejected or past its expiry
- **jobs** — the last successful run isn't stale *while inside the daily window*

```jsonc
{ "status": "ok", "checks": { "database": {...}, "scheduler": {...},
  "waha": { "ok": true, "status": "WORKING", "account": "..." }, "jobs": [...] } }
```

The body contains no secrets (no cookie value, no tokens).

### Wiring it up (do this once)

1. Set `HEALTH_CHECK_TOKEN` to a random value (`openssl rand -hex 16`).
2. Create a monitor in a free uptime service — **[UptimeRobot](https://uptimerobot.com)**
   or **[Better Stack](https://betterstack.com/uptime)** — pointed at
   `https://your-app/api/health?token=YOUR_TOKEN`, checking every 1–5 minutes.
   - Pass the token as the **`?token=`** query param (works on UptimeRobot free,
     which probes with `HEAD` and can't set headers) **or** as an
     `Authorization: Bearer YOUR_TOKEN` header where supported.
3. Configure that monitor to alert you by **email / push / SMS** — a channel
   independent of the app and of WhatsApp. It will fire when the endpoint is
   unreachable (app/host down) or returns `503` (WAHA session expired, cookie
   dead, runs stalled).

This is deliberately *not* a self-sent WhatsApp "I'm alive" message: a dead app
can't send one, and a broken WhatsApp session can't warn you about itself. An
external monitor on an independent channel catches those cases.

## Adding a New Job

Jobs are `JobModule`s registered in a registry and seeded into the database on boot. To add one:

```typescript
// lib/jobs/mychecker/index.ts
import type { JobModule, RunContext, RunResult } from '../types';

export const myChecker: JobModule = {
  slug: 'my-checker',
  defaultMeta: {
    title: 'My Checker',
    url: 'https://example.com',
    description: 'What this job monitors.',
  },
  // optional: customSettingsSchema (zod) + CustomSettingsPanel (React) for per-job settings
  async runCheck(ctx: RunContext): Promise<RunResult> {
    // fetch, diff against ctx.lastSuccessfulItems, notify ctx.recipients via WAHA
    // ...
  },
};
```

```typescript
// lib/jobs/registry.ts
import { myChecker } from './mychecker';
export const jobRegistry: JobModule[] = [dataAnnotation, myChecker]; // add here
```

On the next boot, `seedRegistryJobs` inserts a row for any new slug; configure its schedule and recipients from the dashboard.
