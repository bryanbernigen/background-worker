# Auto Checker — Design Specification

**Date:** 2026-05-18
**Status:** Draft

## 1. Overview

Auto Checker is a Next.js app deployed on Vercel that polls APIs on a randomized schedule, runs custom per-API logic to detect changes, and sends WhatsApp notifications via WAHA when conditions are met. It is designed to be modular — each monitored API is a pluggable "checker" with its own logic, while WhatsApp sending is a shared module.

MVP ships with one checker: DataAnnotation Projects, which monitors `https://app.dataannotation.tech/workers/projects` for new paid projects/qualifications and sends WhatsApp alerts.

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│         NEXT.JS APP (Vercel — free tier)             │
│                                                       │
│  ┌─────────────┐    ┌──────────────┐   ┌───────────┐ │
│  │ Login Page  │    │ Dashboard    │   │ Settings  │ │
│  │   /        │    │   /dashboard │   │  /settings│ │
│  └─────────────┘    └──────────────┘   └───────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │              API Routes (Next.js)                  │ │
│  │   /api/cron/check  — triggered by GitHub Actions │ │
│  │   or manual "Run Now" from dashboard.             │ │
│  │   Picks random delay 5–30 min, only runs 7AM–   │ │
│  │   11PM local time. Calls each checker's run().   │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌────────────┐    ┌────────────┐   ┌──────────────┐ │
│  │ DataAnnota │    │  (future) │   │    WAHA      │ │
│  │  Checker  │    │  Checker  │   │   Client     │ │
│  │  Module   │    │  Module   │   │   (shared)   │ │
│  └────────────┘    └────────────┘   └──────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Vercel KV (free tier — 3k writes/day)  │ │
│  │   Stores: cookie jar, last seen projects list,  │ │
│  │   cron lock, user settings, WhatsApp recipient   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │    WAHA API (Waha)      │
              │    (WhatsApp)           │
              └─────────────────────────┘
```

**All cron logic runs server-side** — no client polling. GitHub Actions fires every 1 minute as a lightweight heartbeat, which calls `/api/cron/check` on Vercel. The handler decides internally whether to actually hit the API based on:
- Whether `next_allowed_run` in KV has elapsed (random 5–30 min intervals)
- Time window check (7AM–11PM only)

This produces truly random hit times (e.g. 7:01:23 → 7:08:42) rather than fixed-interval patterns.

## 3. Authentication & State

### Login
- Single-user app. Hardcoded credentials: `admin` / `P@assword123`
- On login, set an HTTP-only session cookie (simple JWT or signed token)
- No database needed for auth — just verify against env var / hardcoded values
- Middleware protects all routes except `/`

### Cookie Storage
- The DataAnnotation cookie is stored in **Vercel KV** (keyed by `da_cookie`)
- On the Settings page, the user pastes their full `cookie` header value
- The cron handler reads it from KV at runtime and passes it to the DataAnnotation checker
- Cookie expires are managed by the user — the app does a test request and logs if it fails due to auth expiry

### WhatsApp Recipient
- Stored in Vercel KV under `wa_recipient` (phone number string, e.g. `6281234567890`)
- Configured on the Settings page

### Last Seen State (for deduplication)
- Vercel KV key `da_last_seen` stores a JSON object: `{ projects: [...projectIds], qualifications: [...qualIds], updatedAt: "..." }`
- After each scrape, the new list is compared against last seen. Only new items with pay info trigger WhatsApp

## 4. DataAnnotation Checker Module

### How it works
1. Fetch `https://app.dataannotation.tech/workers/projects` with the stored cookie
2. Parse the response HTML — extract the `data-props` JSON from `<div id="workers/WorkerProjectsTable-hybrid-root" ...>`
3. Parse the JSON — extract `projects[]` and `qualifications[]` arrays
4. Filter items where `pay` is non-empty (contains `$`)
5. Compare against `da_last_seen`:
   - Any project ID or qualification ID not in last seen → new → queue WhatsApp
   - Any ID in last seen but not in current response → removed (no notification, just update state)
6. Update `da_last_seen` in KV with the new combined list

### DataAnnotation Response Structure (from HTML)
The HTML contains a `data-props` attribute on the div. Its JSON contains:
- `reportableProjectsInfo[]` — reportable projects
- `dashboardMerchTargeting.qualifications[]` — qualifications
- `dashboardMerchTargeting.projects[]` — general projects
- Each item has: `id`, `name`, `pay`, `availableTasksFor`, `created`, `qualification` (bool)

### WhatsApp Message Format
```
🎯 *DataAnnotation — New Paid Work!*

🆕 *NEW PROJECT:*
[Project Name]
💰 Pay: $XX.00/hr
📋 Tasks: N available
🔗 https://app.dataannotation.tech/workers/projects

---
Sent via Auto Checker
```

For qualifications:
```
🎯 *DataAnnotation — New Paid Qualification!*

🆕 *NEW QUALIFICATION:*
[Qualification Name]
💰 Pay: $XX.00/hr
📋 Tasks: N available
🔗 https://app.dataannotation.tech/workers/projects

---
Sent via Auto Checker
```

If multiple new items, batch into one message with a list.

## 5. Scheduling: GitHub Actions + Vercel API

**Why not Vercel Cron?** Vercel Cron only supports fixed intervals (every 5 min, every 1 hr, etc.). A fixed 5-minute trigger produces predictable timestamps that could be flagged as bot behavior. We need truly random intervals.

**How it works:**

```
GitHub Actions (every 1 minute — free)
    │
    └── curl /api/cron/check on Vercel

/api/cron/check handler:
    │
    ├── Check time window (7AM–11PM UTC+7)? No → HTTP 200, exit
    ├── Read next_allowed_run from KV?
    │       │
    │       ├── now < next_allowed_run → HTTP 200, exit (too early)
    │       └── now >= next_allowed_run → proceed
    │
    ├── Generate new random interval: random(5, 30) minutes
    │       Store as next_allowed_run = now + random_minutes
    │
    ├── Acquire lock in KV (cron_lock, 5-min TTL) to prevent overlap
    │
    ├── Run all enabled checkers
    │
    └── Release lock, return HTTP 200
```

**GitHub Actions workflow (`.github/workflows/check.yml`):**
```yaml
on:
  schedule:
    - cron: '* * * * *'   # Every 1 minute
  workflow_dispatch:        # Manual trigger
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Call Vercel cron endpoint
        run: curl -X POST https://your-app.vercel.app/api/cron/check
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

The handler validates `CRON_SECRET` from request header to prevent unauthorized triggers.

**Example timeline (truly random):**
```
07:01:23 → Cron fires, next_allowed=T+18min → runs API
07:02:23 → Cron fires, T+1 < T+18 → SKIP
...
07:19:23 → Cron fires, T+18 >= T+18 → runs API, next_allowed=T+7min
07:20:23 → Cron fires, T+1 < T+7 → SKIP
...
07:26:23 → Cron fires, T+7 >= T+7 → runs API, next_allowed=T+23min
```

True random intervals: 18min → 7min → 23min → etc.

## 6. Web UI

### Pages

| Page | URL | Purpose |
|------|-----|---------|
| Login | `/` | Username + password form |
| Dashboard | `/dashboard` | Status, last check time, new items found, recent activity log |
| Settings | `/settings` | Cookie config, WA recipient, checker toggles |

### Login Page
- Clean, centered card
- Username: `admin`, Password: `P@assword123`
- On success → redirect to `/dashboard`
- On failure → show error, no redirect

### Dashboard
- Card: "Last checked: [datetime]" + "Next check: [datetime]"
- Card: "Status: Running / Sleeping / Auth Error"
- Card: Recent WhatsApp notifications sent (last 5)
- Button: "Run Check Now" (manual trigger, hits `/api/cron/check` directly)

### Settings
- Cookie input: `<textarea>` for pasting the full cookie string
  - Label: "DataAnnotation Cookie"
  - Save button → updates KV
- WhatsApp recipient: `<input>` for phone number
- "Send Test WhatsApp" button → sends a test message via WAHA
- Checker toggles: enable/disable individual checkers

## 7. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| State (KV) | Vercel KV (Redis, free tier) |
| Scheduler | GitHub Actions (every 1 min) → Vercel `/api/cron/check` |
| Auth | Simple JWT in HTTP-only cookie |
| WhatsApp | WAHA HTTP API (via `WahaClient` class) |
| HTTP Client | `httpx` (or native `fetch`) |
| HTML Parsing | Native `DOMParser` or `node-html-parser` |
| Deployment | Vercel (free tier) |

## 8. Module System (for Future Checkers)

Each checker is a TypeScript module implementing:
```typescript
interface Checker {
  name: string;           // e.g. "DataAnnotation"
  enabled: boolean;       // from KV / settings
  run(kv: KV): Promise<void>;  // fetch, diff, notify
}
```

The cron handler imports all checkers from a registry:
```typescript
// lib/checkers/index.ts
export const checkers: Checker[] = [
  dataAnnotationChecker,
  // futureChecker2,
  // futureChecker3,
];
```

Each checker manages its own:
- API endpoint + headers
- Parsing logic
- Diff logic (compare current vs last seen)
- WhatsApp message formatting
- State keys in KV (prefixed by checker name)

## 9. Vercel KV Schema

| Key | Type | Description |
|-----|------|-------------|
| `da_cookie` | string | Full cookie string for DataAnnotation |
| `da_last_seen` | JSON | `{ projects: string[], qualifications: string[] }` |
| `next_allowed_run` | string | ISO timestamp — handler only runs when `now >= this` |
| `cron_lock` | string | Lock token (prevents overlapping runs) |
| `wa_recipient` | string | WhatsApp recipient phone number |
| `wa_enabled` | string | `"true"` or `"false"` |
| `session_token` | string | Signed JWT for web login |
| `activity_log` | JSON | Array of recent activity entries |

## 10. WAHA Integration

Reuse the `WahaClient` pattern from promo-hunter:
- `POST {WAHA_URL}/api/sendText`
- Body: `{ session: "default", chatId: "{phone}@c.us", text: "..." }`
- Auth: `x-api-key` header if configured
- WAHA URL stored as env var `WAHA_URL`
- API key as env var `WAHA_API_KEY`

## 11. Environment Variables

| Variable | Description |
|----------|-------------|
| `KV_REST_API_URL` | Vercel KV REST API URL |
| `KV_REST_API_TOKEN` | Vercel KV REST API token |
| `WAHA_URL` | WAHA API base URL (e.g. `http://host.docker.internal:3001`) |
| `WAHA_API_KEY` | WAHA API key (optional) |
| `ADMIN_PASSWORD` | Override default admin password |
| `JWT_SECRET` | Secret for signing session JWT |
| `CRON_SECRET` | Secret token that GitHub Actions sends in request header to authorize cron calls |

## 12. Development Phases

### Phase 1 — MVP
1. Scaffold Next.js project with TypeScript + Tailwind
2. Set up Vercel KV client
3. Build login page + middleware
4. Build dashboard and settings pages
5. Implement DataAnnotation checker (fetch → parse → diff → notify)
6. Implement WAHA client
7. Wire up `/api/cron/check` with time-window + random-interval logic
8. Create GitHub Actions workflow to trigger cron every 1 minute
9. End-to-end test

### Phase 2 — Polish
- Activity log on dashboard
- Manual "Run Now" trigger
- Auth expiry detection (if DataAnnotation returns 401, show warning in UI)
- Settings page validation

### Phase 3 — Future Checkers (out of scope for now)
- Add new checker module → implement interface → add to registry
- Each checker gets its own KV keys prefixed by name

---

*End of spec*
