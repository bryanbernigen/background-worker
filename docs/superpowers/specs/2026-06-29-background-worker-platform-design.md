# Background Worker Platform — Design Spec

**Date:** 2026-06-29
**Status:** Approved (brainstorm) — ready for implementation planning
**Supersedes the framing of:** `auto-checker` (DataAnnotation-specific scraper/notifier)

## 1. Summary

Re-frame the existing `auto-checker` app from a single-purpose DataAnnotation
monitor into a generic **background-worker runtime** ("Flink-lite"): a control
plane that hosts long-running, scheduled jobs. You submit a job, it runs 24/7,
the platform owns its lifecycle (schedule, run, monitor, restart, inspect), and
DataAnnotation monitoring becomes the first job *type* running on it.

This is an **evolution, not a rewrite**. The current code already has the right
skeleton: a pluggable `JobModule` registry, an in-process scheduler with
per-job timers / daily windows / advisory locks / run history / failure-streak
alerts, encrypted settings, auth, health checks, and WhatsApp (WAHA)
notifications. The work is (a) generalizing the DataAnnotation-specific domain
model out of the runtime core, (b) supporting multiple job *instances* per
*type*, (c) adding a single-admin / read-only-guest access model with
server-side PII masking, and (d) a UI overhaul to a "Split Console" control
plane that matches the main portfolio's dark/cyan theme.

It remains a **single-deployment, single-admin** tool. It is *not* a multi-tenant
SaaS and does *not* execute untrusted user-uploaded code (see §10, Non-Goals).

## 2. Context & Goals

- **Primary use:** Bryan's personal 24/7 job runtime (today: DataAnnotation).
- **Secondary use:** a portfolio piece. The companion main portfolio lives at
  `X:/portofolio` (Astro + Tailwind v4). This app is the *secondary* site that
  hosts background-worker / scheduling projects and is linked from the portfolio.
  It should read as part of the same family (shared visual language).
- **Sharing story:** Job *code* lives in the repo (git); job *config* lives in
  each deployment's DB. A friend who self-hosts gets the same job *types* by
  pulling the code, then creates his own *instances* with his own credentials and
  recipients. Sharing means sharing code, never data.

### Success criteria

1. DataAnnotation monitoring works **exactly as today** — same scraping,
   randomized-window scheduling, diff-and-notify, cookie-expiry warnings,
   failure-streak alerts — but as one registered job *type*.
2. The admin can create **multiple instances** of a job type (e.g. two
   DataAnnotation monitors with different cookies / schedules / recipients).
3. The runtime core (scheduler, run history, health) contains **no**
   DataAnnotation-specific vocabulary (`paidProjects`, `qualifications`, …).
4. A **guest** can view the dashboard read-only with PII masked server-side and
   guest-hidden jobs withheld entirely.
5. Notifications use **one** global WhatsApp sender; recipients are per-job.

## 3. Core Concepts

| Concept | What it is | Where it lives |
|---|---|---|
| **Job type** | A `JobModule`: code that knows how to `run()` (scrape/diff/notify, etc.) | Repo — `lib/jobs/<type>/`, registered in `registry.ts`, shipped with the deploy |
| **Job instance** | A configured, schedulable unit: which type + schedule + settings + recipients | DB — one `jobs` row |
| **Run** | One execution of an instance, with a generic result | DB — one `run_history` row |
| **Notification sender** | The single shared WhatsApp/WAHA account | App-level config (env + Settings UI) |
| **Recipient** | A person notified for a specific instance, optionally tagged | DB — `recipients` row (per instance) |

"Submitting a job" = the admin creates an **instance** of an installed **type**
through the UI. No code is uploaded at runtime; the type ships with the deploy.

## 4. Generic Job Model (the core contract)

### 4.1 The `run()` contract

`JobModule` is generalized so the runtime is domain-agnostic:

```ts
interface JobModule {
  type: string;                       // was `slug` — stable id of the type, e.g. "data-annotation"
  defaultMeta: { title: string; url: string; description: string };
  customSettingsSchema?: ZodSchema;   // per-instance settings (e.g. the cookie)
  CustomSettingsPanel?: ComponentType<{ jobId: number; current: unknown }>;
  run(ctx: RunContext): Promise<RunResult>;   // was `runCheck`
}

interface RunResult {
  status: 'ok' | 'error' | 'skipped';
  summary: string;          // short human line: "4 new paid projects", "no change"
  data?: unknown;           // free-form JSONB the type defines for itself
  errorMessage?: string;
  notificationSent: boolean;
  rawHtml?: string;         // optional debug payload on error (kept generic as `debug`?) — see note
}
```

- All DataAnnotation counters (`paidProjects`, `allQualifications`,
  `newPaidProjects`, …) **move into `data`** and out of the runtime types and the
  `run_history` columns.
- `extractedItems` (used for diffing) also moves under the type's control — see §4.2.
- **Note on `rawHtml`:** generalize to an optional `debug?: string` (or keep
  `data` carrying it). Decided at planning time; not load-bearing.

### 4.2 Diff-and-notify is a reusable capability, not core

Detecting "what's new and notify" is *one capability* DataAnnotation opts into,
not part of the runtime contract. Provide a small shared helper the type calls:

```ts
// lib/jobs/lib/diff-notify.ts (shared, opt-in)
diffNewItems(current, previous, keyFn) → newItems
```

The runtime stops persisting `extractedItems` as a first-class column. Instead a
type stores whatever state it needs to diff against in its run `data` (or its
`customSettings`), and the runtime exposes the previous successful run's `data`
via `ctx.lastSuccessful`.

### 4.3 RunContext

```ts
interface RunContext {
  jobId: number;
  meta: { title: string; url: string; description: string };
  custom: unknown;                 // this instance's customSettings
  db: typeof db;
  recipients: { id: number; name: string; phone: string; tag: string | null }[];
  lastSuccessful: unknown;         // `data` from the previous ok run (was lastSuccessfulItems)
  notify(message: string, opts?: { tag?: string }): Promise<boolean>;  // see §6
}
```

`ctx.notify` replaces direct `WahaClient` use inside job code, decoupling job
logic from the delivery channel (§6).

## 5. Scheduling

Keep the existing in-process timer engine (`lib/scheduler`) — per-job timers,
advisory locks, HMR-safe globals, `nextRunAt` persistence, failure-streak
alerts, cookie-expiry warnings. Generalize the **schedule type** per instance:

| Schedule type | Config | Notes |
|---|---|---|
| **Fixed interval** | `intervalS` | "every N seconds/minutes" — common case |
| **Cron** | `cronExpr` + `tzOffsetH` | "every day at 09:00", etc. |
| **Randomized window** | `minIntervalS`, `maxIntervalS`, `dayStartHour`, `dayEndHour`, `tzOffsetH` | today's anti-detection behavior; DataAnnotation default |

`computeNextRunAt` / `isWithinWindow` (in `lib/scheduler/window.ts`) gain a
branch per schedule type. The randomized-window math is retained unchanged for
that type. A small, well-tested cron parser is added (library or minimal
in-house; decided at planning time).

The cookie-expiry warning mechanism is **DataAnnotation-specific** today
(reads `cookie_expires_at` from `customSettings`). Keep it working, but it
should be driven by the type rather than hardcoded in the scheduler — e.g. a
type may expose an optional `nextDeadline(ctx)` hook the scheduler arms a
warning timer against. (Planning detail; preserve current behavior either way.)

## 6. Notifications

**One sender, many recipients, per-job tags.**

- **Sender (global, app-level):** one WAHA/WhatsApp session for the whole app,
  configured via existing env (`WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION`) and
  surfaced read-only-ish in **Settings → Notifications** (status from the health
  check; "Send test"; link/instructions to re-scan QR).
- **Channel abstraction:** introduce a minimal interface so additional channels
  are a future drop-in, but **only WhatsApp/WAHA is implemented now**:
  ```ts
  interface NotificationChannel { sendText(to: string, msg: string): Promise<boolean>; }
  ```
  Job code never imports `WahaClient` directly — it calls `ctx.notify(...)`,
  which fans out to the instance's recipients (optionally filtered by `tag`)
  over the configured channel.
- **Recipients (per instance):** `recipients` rows keyed by `jobId`. Replace the
  hardcoded `kind` enum (`'project' | 'cookie'`) with a free-form `tag` the type
  defines. DataAnnotation uses tags `new-task` (new project/qual alerts) and
  `cookie-expiry` (24h cookie warnings).

## 7. Access Control & PII Masking

Two roles, single deployment. **Simple.**

- **Admin** — authenticates with `ADMIN_PASSWORD_HASH` (existing). Full access:
  unmasked data, all jobs, all actions (create/edit/run/pause/delete), settings.
- **Guest** — read-only. Either no password or a separate guest password
  (decided at planning; default: a distinct guest entry that issues a guest
  session). Sees masked PII, no action controls, and guest-hidden jobs are
  withheld.

### 7.1 Implementation

- **Session role:** extend the session token payload (`lib/auth.ts`) from
  `{ username, exp }` to `{ username, role: 'admin' | 'guest', exp }`. Middleware
  and API routes read the role.
- **Server-side masking (mandatory):** all masking happens **before data leaves
  the server**. The guest never receives raw PII in any API response or RSC
  payload — masking in the browser is explicitly rejected (devtools leak).
  - Phone: `+62 812-3456-7890` → `+62 812-****-7890` (mask middle).
  - Secrets (cookie values, tokens): never sent to guests at all — replaced with
    `"hidden"` / omitted.
  - "Mid-sensitive" fields: truncated preview server-side.
  - Implement as a `maskForRole(data, role)` boundary applied in each read
    endpoint / server component that serves potentially-sensitive data.
- **Per-job guest visibility:** new boolean `jobs.visibleToGuest` (default true).
  Guest-facing queries **filter out** non-visible jobs server-side (not CSS) so
  hidden jobs never appear in the rail, detail, history, or API.
- **Write protection:** all mutating API routes require `role === 'admin'`
  (defense in depth, not just hidden buttons).

## 8. Data Model Changes (Drizzle / Postgres)

Migrations are additive where possible; a data-migration backfills existing rows.

### `jobs`
- **Add** `type text not null` — which `JobModule` powers this instance.
  (Today `slug` doubles as both type and unique instance id.)
- **Keep** `slug text not null unique` as the instance's stable url-id, but it is
  now per-instance (e.g. `data-annotation-main`), no longer == type.
- **Add** `scheduleType text not null default 'window'` (`'window' | 'interval' | 'cron'`).
- **Add** `intervalS integer`, `cronExpr text` (nullable; used by the matching type).
- **Keep** `minIntervalS`, `maxIntervalS`, `dayStartHour`, `dayEndHour`,
  `tzOffsetH` (used by `'window'`).
- **Add** `visibleToGuest boolean not null default true`.
- **Keep** `customSettings jsonb`, `enabled`, `nextRunAt`, `lastRunAt`, timestamps.

### `recipients`
- **Replace** `kind` (enum-ish text) with `tag text` (nullable, free-form).
  Backfill `'project'→'new-task'`, `'cookie'→'cookie-expiry'`.

### `run_history`
- **Drop** the DataAnnotation-specific columns (`paidProjects`, `allProjects`,
  `paidQualifications`, `allQualifications`, `newPaidProjects`, `newAllProjects`,
  `newPaidQualifications`, `newAllQualifications`, `extractedItems`).
- **Add** `summary text` and `data jsonb` (generic result payload).
- **Keep** `status`, `triggerType`, `skipReason`, `diffMs`, `rawHtml`/`debug`,
  `errorMessage`, `notificationSent`, timing, indexes.
- **Backfill:** fold old columns into `data` for historical rows (best-effort;
  history is not load-bearing).

### Seeding
- `seedRegistryJobs` no longer auto-creates one row per registered type. Instead
  the **registry is a catalog of types**; instances are created by the admin.
  A one-time data migration converts the existing single DataAnnotation row into
  an instance (`type='data-annotation'`, `slug='data-annotation'`,
  `scheduleType='window'`) so nothing breaks on upgrade.

## 9. UI Overhaul — "Split Console"

Dark theme matching `X:/portofolio/src/styles/global.css`:
`--color-bg #0e0f13`, `--color-surface #16181f`, `--color-surface-2 #1d2029`,
`--color-border #2a2e3a`, `--color-text #e7e9ee`, `--color-muted #9aa3b2`,
`--color-accent #22d3ee`. Inter for body, mono for uppercase micro-labels.
Status colors: ok `#34d399`, warn `#fbbf24`, error `#f87171`, off `#52525b`.

### Layout: rail + detail
- **Left rail:** list of job instances with a status dot (running/ok, errored,
  paused/off). Admin sees a `＋` to submit a job and a `🔒` marker on
  guest-hidden jobs. Below jobs: **Settings** entries (Notifications, Access).
- **Right detail pane** (selected job): header (name, type, schedule, next-run
  countdown, health/cookie status) + admin action buttons (Run now, Pause/Resume,
  Edit, Delete); **Recipients** (with tags); **Recent runs** (status dot, time,
  `summary`); expandable run detail.
- **Guest view:** same layout, no action buttons ("view only"), PII masked,
  hidden jobs absent from the rail.

### Submit-a-job flow (admin)
1. Pick a **type** from the installed catalog (registry).
2. Configure the **instance**: name, schedule (type + params), guest visibility,
   type-specific `CustomSettingsPanel` (e.g. paste cookie).
3. Add **recipients** with tags.
4. **Create & start** → writes the `jobs` row, arms the scheduler.

### Settings
- **Notifications:** global WhatsApp sender status (from health check),
  "Send test", re-scan QR guidance.
- **Access:** guest mode on/off, guest password (if used).

Existing per-job components (`schedule-form`, `recipients-panel`,
`history-table`, `run-now-button`, `enable-toggle`, `editable-header`,
`countdown`) are largely reusable, restyled into the console and gated by role.

## 10. Non-Goals (YAGNI)

- **No runtime code upload / zip / sandbox.** Job types are code shipped with the
  deploy. Untrusted-code execution (the literal "submit a JAR") is explicitly out
  of scope; this model is a clean stepping stone if it's ever wanted.
- **No multi-tenant / multi-user accounts.** One admin + one guest tier only.
- **No additional notification channels built now** (email/Telegram/Discord) —
  only the abstraction seam, WhatsApp is the sole implementation.
- **No distributed/worker-cluster execution.** Single in-process scheduler, as
  today.
- **No new-feature creep** in DataAnnotation logic; it is preserved, only refactored.

## 10a. Project Rename

Decision: **evolve this repo in place** (do not start a fresh repo — the
scheduler/locks/timer logic is subtle, production-tested, and not worth
rewriting; the git history of "scraper → job runtime" is itself a good
portfolio story). Rename the project identity from `auto-checker` to
`background-worker`:

- `package.json` `name` → `background-worker`.
- GitHub repo rename `auto-checker` → `background-worker` (history preserved;
  update the local `origin` URL afterward).
- Local folder `X:/playground/auto-checker` → `X:/playground/background-worker`
  (do this when no process holds the folder — not mid-session).
- Update references in `README.md`, `Dockerfile`, deploy docs, and the
  Northflank service/`DATABASE_URL` db name (`auto_checker`) as convenient;
  cosmetic, can trail the code changes.

## 10b. Repo Hygiene / Root Cleanup

The repo root is cluttered (~20+ entries). Most are tooling configs that
*must* live at root (`next.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`,
`postcss.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `vitest.config.ts`,
`vercel.json`, `next-env.d.ts`, `instrumentation.ts`, `middleware.ts`,
`package.json`, `Dockerfile`, `.env*`, `README.md`, `AGENTS.md`, `CLAUDE.md`).
Those stay. The realistic wins are the loose sample/debug artifacts:

- **`example_response.html`** (127 KB) — *referenced* by `lib/jobs/data-annotation/fetch.ts`
  as a local dev fixture (`DATAANNOTATION_USE_LOCAL`). **Move** into the module:
  `lib/jobs/data-annotation/fixtures/example_response.html`, and update the path
  in `fetch.ts`.
- **`example_headers.txt`** — unreferenced debug leftover. **Delete** (it's also
  in `.gitignore`).
- **`cron_response.json`** — unreferenced debug leftover. **Delete**.
- **`middleware.test.ts`** — optional: colocate test convention is fine; leave or
  move alongside other tests. Low priority.

Goal: root holds config + entrypoints only; sample data and fixtures live with
the code that uses them.

## 11. Migration / Compatibility Notes

- DataAnnotation module: rename `slug`→`type`, `runCheck`→`run`; move counter
  computation into `data`; adopt `ctx.notify`; adopt the shared diff helper. Its
  `fetch.ts`, `parse.ts`, `diff.ts`, `format.ts`, `settings-panel.tsx` and
  cookie-state persistence are otherwise retained.
- Health checks: the `jobs` sub-check and WAHA/cookie checks remain; update field
  references (no more `paidProjects` etc.).
- One forward-only data migration converts the existing job row + recipients;
  run-history backfill is best-effort.

## 12. Open Questions (resolve during planning)

1. Cron parsing: small library vs. minimal in-house parser.
2. Guest auth: open read-only vs. dedicated guest password.
3. `rawHtml` → generic `debug` field naming.
4. Cookie-expiry warning: generalize via a type hook vs. keep a DataAnnotation
   special-case in the scheduler for now.
