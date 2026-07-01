# Background Worker — Phase 2 Design: Multi-instance + Schedule Types + Create-instance API

**Date:** 2026-06-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-background-worker-platform-design.md` (§3, §5, §8)
**Builds on:** Phase 1 (`docs/superpowers/plans/2026-06-29-background-worker-phase-1-generic-core.md`), merged to `main`.

## 1. Goal

Turn the generic job runtime into a **multi-instance** platform: the admin can run
many configured instances of an installed job *type*, each with its own schedule.
Add two new schedule types (`interval`, `cron`) alongside the existing randomized
`window`, expose a **create-instance API** (no UI yet — that's Phase 4), and stop
auto-seeding so the registry becomes a pure *type catalog*.

DataAnnotation continues to work exactly as today as one `window`-scheduled instance.

## 2. Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Create-instance surface in Phase 2 | **API-only** + conversion migration. No web UI until Phase 4. |
| 2 | Cron engine | **`croner`** (small zero-dep lib). Fed UTC; we apply `tzOffsetH` ourselves (lib's IANA tz unused) to stay consistent with the offset model. |
| 3 | Cookie-expiry warning | **Keep the DataAnnotation special-case** in the scheduler. Generalizing it (type deadline hook) is deferred. |
| 4 | Instance `slug` assignment | **Auto-slugify from `name`**, optional explicit `slug` override, numeric suffix on collision. |
| 5 | `rawHtml` → `debug` rename | **Deferred** (keep `rawHtml`), consistent with Phase 1. |
| 6 | Auth / roles | **No change.** Roles/guest/PII masking are Phase 3. Phase 2 routes use the existing admin session gate (`requireSession`). |
| 7 | `POST` payload schedule shape | **Nested discriminated `schedule` object** (zod discriminated union on `type`), mapped to flat columns server-side. |

## 3. Data Model — migration `0003_schedule_types`

`jobs` gains three columns:

- `scheduleType text not null default 'window'` — `'window' | 'interval' | 'cron'`.
- `intervalS integer` (nullable) — used when `scheduleType = 'interval'`.
- `cronExpr text` (nullable) — used when `scheduleType = 'cron'`.

Notes:
- The existing DataAnnotation row adopts `scheduleType='window'` via the default;
  its window params (`minIntervalS`, `maxIntervalS`, `dayStartHour`, `dayEndHour`,
  `tzOffsetH`) are untouched and keep driving it.
- `slug` stays `not null unique` but is now a **per-instance** id distinct from
  `type` (e.g. `type='data-annotation'`, `slug='data-annotation-main'`). No data
  change needed for the existing row (its `slug` is already unique).
- **Not** in this migration: `visibleToGuest` (Phase 3).
- Drizzle artifacts are hand-authored if `drizzle-kit generate`'s interactive TUI
  can't be driven (same approach Phase 1 used); validated by re-running generate →
  "No schema changes". Apply with the env caveat below.

> **Env caveat (carried from Phase 1):** `npm run migrate` runs under `tsx`, which
> does NOT auto-load `.env*`, and `.env` holds a remote GCP URL that shadows the
> local Docker URL in `.env.local`. Apply with
> `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts` (`.env.local`
> last so it wins).

## 4. Schedule Engine (`lib/scheduler/window.ts`)

A per-instance config carries `scheduleType` plus the relevant params. Two pure
functions branch on it:

- **`computeNextRunAt(now, cfg): Date`**
  - `window` — existing randomized-window math, **unchanged**.
  - `interval` — `now + intervalS * 1000`.
  - `cron` — `croner` computes the next fire time; we evaluate against UTC and
    apply `tzOffsetH` so a `0 9 * * *` at `tzOffsetH=7` fires at 09:00 in that
    offset, mirroring how `window` interprets `dayStartHour`.
- **`isWithinWindow(now, cfg): boolean`** — returns the existing result for
  `window`; returns `true` for `interval`/`cron` (those fire exactly at their
  computed time, with no day-window skip).

A small **`validateSchedule(cfg)`** asserts the params required by each type are
present and sane (`interval` needs a positive `intervalS`; `cron` needs a
croner-parseable `cronExpr`; `window` needs its existing fields). Used by the
create/update API and unit-tested directly.

## 5. Registry as a Type Catalog

- `getJob(type)` unchanged; `jobRegistry` is the catalog of installed types.
- **Remove auto-seeding:** `seedRegistryJobs` no longer inserts a row per type and
  `instrumentation.ts` stops calling it. The existing DA row is already a valid
  instance, so upgrade is a no-op; a fresh deploy starts with **zero** instances
  and the admin creates them via the API.
- **`GET /api/jobs/types`** — returns the catalog: `[{ type, defaultMeta,
  hasSettingsPanel: boolean }]`, for create-flow discovery (and the Phase 4 UI).

## 6. Instance CRUD API (admin session-gated)

All routes require the existing session (`requireSession`); role split is Phase 3.

- **`POST /api/jobs`** — create an instance.
  Body (zod-validated):
  ```ts
  {
    type: string,                 // must exist in the registry
    name: string,                 // human label; slug derived from this
    slug?: string,                // optional explicit override (url-safe, unique)
    enabled?: boolean,            // default true
    schedule:                     // discriminated union on `type`
      | { type: 'window', minIntervalS, maxIntervalS, dayStartHour, dayEndHour, tzOffsetH }
      | { type: 'interval', intervalS, /* tzOffsetH optional, retained */ }
      | { type: 'cron', cronExpr, tzOffsetH },
    customSettings?: unknown,     // validated against the type's customSettingsSchema
    recipients?: { name: string, phone: string, tag?: string }[],
  }
  ```
  Server: validate `type` ∈ registry → `validateSchedule` → validate
  `customSettings` against the type's schema (if any) → derive unique `slug`
  (slugify `name`, append `-2`, `-3`… on collision; honor explicit `slug`, 409 if
  taken) → insert `jobs` row (mapping `schedule` → flat columns) → insert any
  `recipients` → if `enabled`, `reschedule(jobId)` to arm timers. Returns the
  created instance (201). Title/url/description default from the type's
  `defaultMeta` unless overridden.

- **`DELETE /api/jobs/[slug]`** — delete an instance: clear its scheduler + expiry
  timers, then delete the `jobs` row (FK-cascades `recipients` and `run_history`).
  Returns 204; 404 if no such slug.

- **Extend the existing schedule/settings update route** to accept `scheduleType`
  + the new params (same discriminated shape) and call `reschedule(jobId)` so a
  type/param change re-arms correctly.

## 7. Scheduler Wiring (multi-instance)

The engine is already per-`jobId` (timers map keyed by id; `start()` arms every
enabled job; advisory locks per job). Phase 2 confirms and exercises N-instance
behavior:

- **Create (enabled):** `armTimer(jobId)` + `armExpiryTimer(jobId)`.
- **Delete:** clear both timers for the job before/after row deletion.
- **Update schedule:** `reschedule(jobId)` (existing) recomputes `nextRunAt` and
  re-arms using the new `scheduleType`.

No change to advisory-lock, HMR-safe globals, failure-streak, or cookie-expiry
logic (the latter stays per-instance as today).

## 8. Testing (TDD per task)

- `window.ts`: `interval` next-run; `cron` next-run via croner at a fixed
  `tzOffsetH` (e.g. `0 9 * * *`, `*/15 * * * *`); `isWithinWindow` returns `true`
  for interval/cron; `validateSchedule` accept/reject cases.
- Slug derivation: slugify, collision suffixing, explicit-override + 409.
- `POST /api/jobs`: bad type, bad schedule params, bad customSettings, happy path
  (row + recipients created, scheduler armed).
- `DELETE /api/jobs/[slug]`: cascade + timer cleanup; 404.
- Multi-instance: two instances of the same type schedule independently.
- Full suite + `tsc --noEmit` + `npm run build` green at the end; DataAnnotation
  behavior unchanged.

## 9. Out of Scope (later phases)

- Split Console UI and submit-a-job form — **Phase 4**.
- Roles (`admin`/`guest`), server-side PII masking, `jobs.visibleToGuest`,
  write-route role guards — **Phase 3**.
- Cookie-expiry generalization via a type deadline hook — deferred.
- `rawHtml` → `debug` rename — deferred.
- Project/repo rename (`auto-checker` → `background-worker`) + root cleanup —
  **Phase 5**.

## 10. Open Questions

None outstanding — the parent spec's §12.1 (cron) and §12.4 (cookie-expiry) are
resolved above; §12.2 (guest auth) and §12.3 (`debug` rename) belong to later
phases.
