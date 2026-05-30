# Multi-Job Scheduler — Design Spec

**Date:** 2026-05-30
**Status:** Approved (pending user review of this written doc)
**Author:** Bryan Bernigen (with Claude)

---

## 1. Context & Motivation

The project began as a single scraper for DataAnnotation, hosted on Railway, with KV state in Upstash Redis and scheduling driven by an external `cron-job.org` ping every minute. Two changes prompted this redesign:

1. **Upstash Redis is no longer free.** The app has been migrated to Northflank, which provides one free additional service (Redis / Postgres / MySQL / MongoDB up to 6 GB).
2. **The single-job model is constraining.** We want to support multiple scheduled scraping jobs over time, each with its own UI, schedule, scraping logic, settings, and history.

This spec defines the redesign: a single Next.js container on Northflank, backed by managed Postgres, with an in-process scheduler that replaces the external cron, and a job-module contract that lets each scraper own its specifics while sharing all generic UI/storage.

## 2. Goals & Non-Goals

**Goals**

- Multi-job dashboard listing all scheduled jobs with status at a glance.
- Per-job page showing editable metadata (title/URL/description), schedule settings (min/max interval, active window, timezone), cookie/secret, recipients (per-job WhatsApp list with add/edit/delete/send-test), and paginated run history.
- In-process scheduler with jitter (`rand(min_interval, max_interval)`) clamped to an active hours window; persisted next-run timestamp so countdown UI is trivial.
- "New item" rule: an item is new if it was absent from the **last successful run** (appear → disappear → reappear counts as new).
- WhatsApp notification trigger: send if `new_paid_projects > 0` OR `new_all_qualifications > 0`.
- 3-strikes failure alert: WhatsApp to all recipients when a job has 3 consecutive `error` runs.
- Single-Dockerfile deployment. Postgres and WAHA are external services configured via env vars.
- Clean cutover: no migration from Upstash. The DA job is re-initialized from hard-coded defaults; cookie/recipients are re-entered via the UI on first launch.

**Non-Goals (v1)**

- Multi-user / multi-tenant. Single admin only.
- Notification retries / a `notifications` table. WAHA delivery failures are logged on the run row.
- UI password rotation (no `auth_users` table). Password rotation = redeploy with new `ADMIN_PASSWORD_HASH`.
- Horizontal scaling. Single replica is assumed; Postgres advisory locks would still serialize across replicas if we ever scaled, but that's not a v1 concern.
- Auto-deletion of orphaned job rows whose slug is no longer in the registry. Keeps data safe across typos and renames.

## 3. Architecture

**One Next.js 16 container on Northflank, talking to managed Postgres on Northflank.** WAHA stays as its own Northflank service the app calls over HTTP. No Redis, no external cron, no Upstash.

The container runs two concurrent things in one Node process:

1. **Next.js HTTP server** (App Router) — dashboard UI, login, API routes for manual actions (run-now, save settings, recipient CRUD, send-test), and history pagination.
2. **In-process scheduler singleton** — loaded once at boot via `instrumentation.ts`. For each enabled job, reads persisted `next_run_at` from DB and arms `setTimeout` to fire at that moment. On fire: acquire Postgres advisory lock, run the check, write a `run_history` row, compute next jitter (clamped to active window), persist `next_run_at`, re-arm `setTimeout`. Advisory locks (`pg_try_advisory_lock(job_id)`) prevent concurrent runs from any source (scheduler + manual).

**Boot order:** open DB pool → run pending migrations → ensure registry jobs exist in DB → start scheduler → hand off to Next.js HTTP server.

**Why this shape:** single-replica is appropriate for a personal tool; advisory locks make it safe; the scheduler-as-singleton kills the cron-job.org dependency; co-locating UI + worker in one container keeps Northflank cost at one service.

## 4. File Layout & Module Contracts

```
auto-checker/
├── app/
│   ├── (auth)/login/page.tsx              # existing
│   ├── dashboard/
│   │   ├── page.tsx                       # jobs list (auto-built from registry + DB)
│   │   ├── jobs/[slug]/
│   │   │   ├── page.tsx                   # shared job shell (server component)
│   │   │   ├── meta-form.tsx              # title/url/description editor
│   │   │   ├── schedule-form.tsx          # min/max interval + active window
│   │   │   ├── recipients-panel.tsx       # list + add/edit/delete/send-test
│   │   │   ├── history-table.tsx          # paginated runs + show-detail row expander
│   │   │   └── countdown.tsx              # client component, ticks next_run_at − now
│   │   └── settings/page.tsx              # global app settings (kept for any future shared prefs)
│   └── api/
│       ├── jobs/[slug]/run/route.ts       # POST: manual run-now
│       ├── jobs/[slug]/settings/route.ts  # PATCH: save settings (incl. custom panel payload)
│       ├── jobs/[slug]/recipients/...     # CRUD + POST .../[id]/test
│       ├── jobs/[slug]/history/route.ts   # GET: paginated history
│       └── auth/...                       # existing
│
├── lib/
│   ├── db/
│   │   ├── client.ts                      # drizzle + pg pool
│   │   ├── schema.ts                      # all tables in one file
│   │   └── migrations/                    # generated by drizzle-kit
│   ├── scheduler/
│   │   ├── index.ts                       # singleton: start(), runJob(jobId), reschedule(jobId)
│   │   ├── lock.ts                        # pg advisory lock helpers
│   │   └── window.ts                      # active-window + jitter math (pure)
│   ├── crypto.ts                          # aes-256-gcm encrypt/decrypt
│   ├── waha.ts                            # existing, unchanged
│   ├── auth.ts                            # existing (verify password compare during impl)
│   └── jobs/
│       ├── registry.ts                    # exported array of JobModule
│       ├── types.ts                       # JobModule, RunContext, RunResult contracts
│       └── data-annotation/
│           ├── index.ts                   # exports JobModule
│           ├── fetch.ts                   # current code, lightly refactored
│           ├── parse.ts                   # current code
│           ├── diff.ts                    # current code (new-item rule lives here)
│           ├── format.ts                  # current code (WhatsApp message text)
│           └── settings-panel.tsx         # the cookie-editor UI (front/back masked)
│
├── instrumentation.ts                     # Next.js boot hook → scheduler.start()
├── docker-entrypoint.sh                   # migrate, then exec server
├── Dockerfile
├── .env.example
└── docs/superpowers/specs/2026-05-30-multi-job-scheduler-design.md
```

### 4.1 JobModule contract

```ts
// lib/jobs/types.ts
export interface JobModule {
  slug: string;                                  // 'data-annotation'
  defaultMeta: { title: string; url: string; description: string };
  customSettingsSchema?: z.ZodSchema;            // validates whatever the custom panel posts
  CustomSettingsPanel?: ComponentType<{ jobId: number; current: unknown }>;
  runCheck(ctx: RunContext): Promise<RunResult>;
}

export interface RunContext {
  jobId: number;
  meta: { title: string; url: string; description: string };
  custom: unknown;                               // typed by job via customSettingsSchema
  db: DrizzleClient;
  recipients: { id: number; name: string; phone: string }[];
  lastSuccessfulItems: PaidItem[];               // for the "absent in last successful run" rule
}

export interface RunResult {
  status: 'ok' | 'error' | 'skipped';
  paidProjects: number; allProjects: number;
  paidQualifications: number; allQualifications: number;
  newPaidProjects: number; newAllProjects: number;
  newPaidQualifications: number; newAllQualifications: number;
  extractedItems: PaidItem[];                    // always stored on ok runs
  rawHtml?: string;                              // stored only when status === 'error'
  errorMessage?: string;
  // Notification side-effect happens inside runCheck() using ctx.recipients
  // so per-job WhatsApp message formatting stays inside the job module.
}
```

### 4.2 Single point of truth per concern

- **Scheduling math** lives in `lib/scheduler/window.ts` (jitter + active-window clamp). Pure functions, unit-tested.
- **Locking** lives in `lib/scheduler/lock.ts`, wrapping `pg_try_advisory_lock(job_id)`.
- **The "new" rule** lives in `lib/jobs/data-annotation/diff.ts`. Diffs against `lastSuccessfulItems` from `RunContext`, **not** against the full history. The repository layer selects the last successful run's `extracted_items` and passes them in. This keeps the rule literal to the spec ("absent in last *successful* run") and the job module pure.

## 5. Database Schema

Three tables. All declared in `lib/db/schema.ts` so Drizzle generates one coherent initial migration.

```sql
-- jobs — one row per scheduled job. Seeded with 'data-annotation' on first boot.
CREATE TABLE jobs (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  description     TEXT NOT NULL,
  min_interval_s  INTEGER NOT NULL DEFAULT 600,       -- 10 min
  max_interval_s  INTEGER NOT NULL DEFAULT 1800,      -- 30 min
  day_start_hour  INTEGER NOT NULL DEFAULT 7,         -- 0–23 local hour
  day_end_hour    INTEGER NOT NULL DEFAULT 23,
  tz_offset_h     INTEGER NOT NULL DEFAULT 7,         -- WIB
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  custom_settings JSONB   NOT NULL DEFAULT '{}',      -- e.g. {"cookie_encrypted": "..."}
  next_run_at     TIMESTAMPTZ,                        -- scheduler reads/writes; null = compute on boot
  last_run_at     TIMESTAMPTZ,                        -- success or failure; for display
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- recipients — per-job WhatsApp targets.
CREATE TABLE recipients (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,                          -- whatever WAHA accepts (typically E.164)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX recipients_job_id_idx ON recipients(job_id);

-- run_history — append-only log of every run. Retention: forever.
CREATE TABLE run_history (
  id                       BIGSERIAL PRIMARY KEY,
  job_id                   INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  started_at               TIMESTAMPTZ NOT NULL,
  finished_at              TIMESTAMPTZ NOT NULL,
  status                   TEXT NOT NULL,             -- 'ok' | 'error' | 'skipped'
  trigger_type             TEXT NOT NULL,             -- 'manual' | 'scheduled'
  skip_reason              TEXT,                      -- 'outside_window' | 'lock_busy' | NULL
  diff_ms                  BIGINT,                    -- ms since previous run
  paid_projects            INTEGER NOT NULL DEFAULT 0,
  all_projects             INTEGER NOT NULL DEFAULT 0,
  paid_qualifications      INTEGER NOT NULL DEFAULT 0,
  all_qualifications       INTEGER NOT NULL DEFAULT 0,
  new_paid_projects        INTEGER NOT NULL DEFAULT 0,
  new_all_projects         INTEGER NOT NULL DEFAULT 0,
  new_paid_qualifications  INTEGER NOT NULL DEFAULT 0,
  new_all_qualifications   INTEGER NOT NULL DEFAULT 0,
  extracted_items          JSONB,                     -- stored on ok runs (cheap)
  raw_html                 TEXT,                      -- stored only when status='error'
  error_message            TEXT,
  notification_sent        BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX run_history_job_started_idx ON run_history(job_id, started_at DESC);
```

**Notes**

- `custom_settings` is the escape hatch for per-job-specific fields. DataAnnotation stores `{"cookie_encrypted": "nonce:tag:ciphertext"}`. A future job needing an API key stores `{"api_key_encrypted": "..."}`. Adding a new job requires **no schema change** — the JobModule's `customSettingsSchema` validates the blob.
- `next_run_at` lives on `jobs` (the *future* schedule). On boot: read it, `setTimeout(next_run_at − now)`. If `next_run_at < now`, run immediately.
- No `cron_lock` table — Postgres advisory locks handle concurrency. Zero rows, zero cleanup.
- Latest-status badges on the dashboard are derived: latest `run_history` row's `status` + `error_message`.
- No `auth_users` table. Existing env-var auth stays.

**Cutover from Upstash:** none. Hard-coded defaults seed the DA job on first boot; cookie and recipients are re-entered via the UI.

## 6. Data Flow

### 6.1 Scheduled tick

1. `setTimeout` fires for job X → `runJob(jobId)`.
2. `pg_try_advisory_lock(jobId)`. Fail → write `run_history` row with `status='skipped'`, `skip_reason='lock_busy'`, re-arm timer, return.
3. Lock acquired → check active window. Outside → write skipped row with `skip_reason='outside_window'`, compute next window opening, persist `next_run_at`, re-arm.
4. Inside window → look up `JobModule` in registry, load `lastSuccessfulItems` (one query: latest `run_history` row for this job where `status='ok'`, read `extracted_items`), call `module.runCheck(ctx)`.
5. Insert `run_history` row with counts + `extracted_items` (always) + `raw_html` (only on error). If `newPaidProjects > 0 || newAllQualifications > 0`, `runCheck` has already iterated `ctx.recipients` and called WAHA; set `notification_sent=true`.
6. Compute `next_run_at = now + rand(min_interval_s, max_interval_s)`, clamp to next active-window opening if outside, persist `next_run_at` + `last_run_at`, release lock, re-arm `setTimeout`.

### 6.2 Manual run-now

`POST /api/jobs/[slug]/run` — same shape as steps 2, 4, 5 above (acquire lock, run check, write history row) with `trigger_type='manual'`. Two intentional differences from scheduled ticks:

- **Active window is bypassed.** A manual run executes regardless of `day_start_hour` / `day_end_hour`. The whole point of a "Run Now" button is to override the schedule.
- **`next_run_at` is not touched.** The next scheduled tick stays where it was.

Lock contention (someone clicks "Run Now" while a scheduled tick is in flight) returns a 409 to the UI rather than writing a skipped history row — different UX semantics for an explicit user action.

### 6.3 Settings save

`PATCH /api/jobs/[slug]/settings` — writes columns (cookie through `crypto.encrypt()`), then asks the scheduler to clear that job's `setTimeout`, recompute `next_run_at` if intervals changed (new jitter), and re-arm.

### 6.4 Boot sequence (`instrumentation.ts`)

1. Run migrations.
2. For each `JobModule` in the registry, ensure a row in `jobs` exists (insert with `defaultMeta` if missing). Orphan rows (slugs no longer in registry) are left alone.
3. For each enabled job, schedule its timer.
4. Next.js HTTP server starts.

## 7. Error Handling

- **Per-run errors:** caught inside `runCheck`, written to `run_history.error_message` + `raw_html`. Run is recorded, scheduler keeps running.
- **3-strikes WhatsApp alert:** after history insert, query the latest N rows for this job ordered by `started_at desc`. If the most recent 3 are all `status='error'` and the 4th is `'ok'` or absent, send one alert to all recipients. Don't re-alert until a successful run resets the streak. Streak is derived from `run_history`; no counter table.
- **Unhandled rejections:** `process.on('unhandledRejection', log)`; timer keeps running. Advisory locks auto-release on connection close.
- **DB unreachable on boot:** crash the container; let Northflank restart it.
- **WAHA unreachable:** `sendNotification` swallows the error and appends a note to `run_history.error_message`. A delivery failure does **not** flip the run to `status='error'`. (Notification retries are a v2 concern.)
- **Cookie decryption failure** (key rotated/corrupted): job records `status='error'` with `error_message='cookie unreadable — re-enter via UI'`. Dashboard surfaces this on the job card.

## 8. Security

- **Auth:** existing JWT cookie + env-var admin (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`). During implementation, verify how `lib/auth.ts` currently compares passwords; if plaintext, add `bcryptjs` and hash. Password rotation = redeploy with new env var.
- **Cookie at rest:** AES-256-GCM via Node `crypto`. `ENCRYPTION_KEY` env var (32 bytes hex). Stored as `base64(nonce):base64(tag):base64(ciphertext)` in `jobs.custom_settings`. UI shows front/back masked via a server action that decrypts and masks.
- **Hard rule:** the decrypted cookie value never appears in any log line, error message, or thrown error. `lib/crypto.ts` decryption errors are generic; `runCheck` failures involving the cookie produce a fixed message.
- **Internal endpoints:** all `/api/jobs/*` routes verify the session cookie. No `x-cron-secret` shenanigans — there is no external cron.

## 9. Testing

Vitest, already configured. Test the boundaries that have actual logic; skip the rest.

**Worth testing:**

- `lib/scheduler/window.ts` — jitter clamp, active-window arithmetic across midnight, tz handling. Pure functions.
- `lib/crypto.ts` — round-trip, tampered ciphertext fails (GCM auth tag), missing key throws clearly.
- `lib/jobs/data-annotation/diff.ts` — the "new = absent in last successful run" rule, including appear → disappear → reappear = new.
- `lib/jobs/data-annotation/parse.ts` — golden-fixture test against `example_response.html`.

**Skipped in v1:**

- Scheduler integration tests with real timers + real Postgres (flaky for marginal value).
- UI/E2E tests (single-user; manual browser test after meaningful changes is sufficient).
- API route handler tests (thin glue over `lib/`; if `lib/` is tested, routes are mostly serialization).

If a real regression bites, add a targeted test for it then.

## 10. Deployment

### Dockerfile (multi-stage)

```dockerfile
# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/lib/db/migrations ./lib/db/migrations
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
```

`docker-entrypoint.sh`: run migrations, then `exec node server.js`.

Next.js config: `output: 'standalone'`.

### .env.example

```bash
# --- App ---
JWT_SECRET=                    # 32+ random chars; openssl rand -hex 32
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=           # bcrypt hash of admin password
ENCRYPTION_KEY=                # 32 bytes hex (64 chars); openssl rand -hex 32

# --- Database (Northflank-provided) ---
DATABASE_URL=postgres://user:pass@host:5432/dbname

# --- WAHA (your existing Northflank service) ---
WAHA_URL=https://your-waha.northflank.app
WAHA_API_KEY=

# --- App runtime ---
PORT=3000
NODE_ENV=production
```

### Local dev

- Point `DATABASE_URL` at any Postgres (local install, Northflank dev DB, etc.), fill `.env.local` from `.env.example`, `npm install && npm run dev`.
- Containerized local: `docker build -t auto-checker . && docker run --env-file .env.local -p 3000:3000 auto-checker`.

## 11. Open Items For Implementation

These are flagged so they don't surprise us when writing the plan:

1. **`lib/auth.ts` password comparison** — verify whether passwords are plaintext or hashed; if plaintext, add bcrypt as part of this work.
2. **Next.js 16 `instrumentation.ts` API** — verify against `node_modules/next/dist/docs/` before wiring the scheduler boot hook (per project AGENTS.md, this is breaking from training-data Next.js).
3. **Migration runner inside Docker entrypoint** — pick between `drizzle-kit migrate` (needs devDeps in image) and a tiny programmatic runner using just the migrations folder + `pg`. Lean toward the latter to keep the runtime image small.
4. **New dependencies introduced by this work:** `drizzle-orm`, `drizzle-kit` (dev), `pg`, `zod` (for `customSettingsSchema`), and `bcryptjs` (only if `lib/auth.ts` currently compares plaintext — TBD per item 1). To remove: `@upstash/redis`.
