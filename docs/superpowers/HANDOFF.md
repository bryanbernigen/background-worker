# Background Worker — Session Handoff (2026-07-01)

This file captures the state of the `auto-checker → background-worker` overhaul so
work can resume after the local folder / GitHub repo is renamed (which breaks the
chat link). It's committed to the repo, so it survives the rename.

## What this project is now

`auto-checker` (a single-purpose DataAnnotation scraper + WhatsApp alerter) has been
evolved **in place** into **`background-worker`**: a generic 24/7 job-runtime /
control plane. DataAnnotation is now one *job type* among potentially many. Design
lives in `docs/superpowers/specs/2026-06-29-background-worker-platform-design.md`;
each phase has its own spec + plan under `docs/superpowers/{specs,plans}/`.

**Stack:** Next.js 16 (App Router, RSC), TypeScript, Drizzle ORM + Postgres, Vitest,
Tailwind v4, WAHA (WhatsApp). 128 tests, `tsc` clean, `npm run build` green.

## Phases delivered (all merged to `main`, local only — see "Git state")

| # | What | Merge |
|---|------|-------|
| 1 | Generic core: `JobModule {type, run()}` → `{status, summary, data}`; `run_history` generalized to `summary`+`data`; `jobs.type`; `recipients.kind`→`tag`; diff+notify as opt-in helpers | `0eea8b0` |
| 2 | Multi-instance + schedule types (`window`/`interval`/`cron` via `croner`); create API (`POST /api/jobs`, `DELETE /api/jobs/[slug]`, `GET /api/jobs/types`); registry became a type catalog (no auto-seed); `jobs.scheduleType/intervalS/cronExpr` | `2b43707` |
| 3 | Access control: session `role` (admin/guest; tokenless guest gated by admin `guest_mode`); server-side PII masking; `jobs.visibleToGuest`; edge + handler write-guards; guest "Request full access" contact form (WhatsApps admin); `app_settings` k/v table | `6f41be2` |
| 4 | Split Console UI + dark/cyan theme (rail + detail via `app/dashboard/layout.tsx`); submit-a-job at `/dashboard/new`; Settings (Notifications, Access); schedule-type editing | `ac83a86` |
| 5 | Partial rename + root cleanup: package → `background-worker`; DA fixture moved into module (kept gitignored — has API keys); deleted debug files; README title | `26e6220` |
| — | Follow-up: dark-theme fix for DA cookie panel + contact form | `d872d5a` |
| — | Follow-up: **editable WAHA connection in the UI** (URL/key/session in DB, key encrypted+masked, env fallback) | `4400677` |

## Architecture cheat-sheet

- **Jobs:** type = code in `lib/jobs/<type>/` (DataAnnotation is the only type), registered in `lib/jobs/registry.ts`. Instance = a `jobs` DB row. `getJob(type)` resolves the module; `listJobTypes()` is the catalog.
- **Scheduler:** `lib/scheduler/index.ts` — per-`jobId` in-process timers, advisory locks, HMR-safe globals. `computeNextRunAt`/`isWithinWindow`/`validateSchedule` branch on `scheduleType` in `lib/scheduler/window.ts`. `reschedule(id)` / `unschedule(id)`.
- **Access:** `lib/access/{role,mask,settings,paths}.ts`. `resolveRole()` (Node/DB), `requireAdmin`/`requireViewer`; masking applied in read routes; middleware does a DB-free edge write-guard.
- **Runtime config in DB:** `app_settings` (key/value jsonb, values wrapped as `{v}`). `lib/access/settings.ts` has `getStringSetting`/`setStringSetting` + typed accessors (guest_mode, admin_contact_phone). **WAHA config** lives in `lib/waha-config.ts` (`getWahaConfig`/`getWahaChannel`/`wahaConfigStatus`/`applyWahaPatch`) — DB-over-env, key encrypted via `lib/crypto`, masked on read.
- **Notifications:** one global WAHA sender; `buildNotifier(recipients, channel)` fans out; recipients tagged (`new-task`, `cookie-expiry`).
- **Migrations 0000–0004** in `lib/db/migrations/`. `run_history` = generic `summary`/`data`; DA counters live inside `data`.

## Git state (IMPORTANT)

- Everything is on **`main`, merged locally, NOT pushed** — `main` is **~66 commits ahead of `origin/main`**. `git push` when ready.
- Each phase was a `feat/…` branch, merged `--no-ff`, then deleted.

## Local dev / operational gotchas

- **DB:** local Postgres is a Docker container `postgres:18-trixie` on `localhost:5432`. `.env.local` has the local `DATABASE_URL`; **`.env` has a REMOTE GCP URL** that shadows it.
- **Migrations:** `npm run migrate` uses `tsx`, which does NOT auto-load `.env*`. Run:
  `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts` (`.env.local` LAST so local wins). Next.js dev/build DO auto-load `.env.local` (it wins over `.env`).
- **Drizzle migrations are hand-authored** (the `drizzle-kit generate` TUI can't be driven non-interactively): write the `.sql` + `meta/<n>_snapshot.json` + `_journal.json` entry, then run `npx drizzle-kit generate` and confirm **"No schema changes"**.
- **Secret-scan pre-commit hook** is active — it caught API keys in the DA fixture (that's why it stays gitignored).
- The DA dev fixture at `lib/jobs/data-annotation/fixtures/example_response.html` is **gitignored** (contains third-party keys); used only under `DATAANNOTATION_USE_LOCAL=true`.

## STILL TO DO (user actions — external to a coding session)

1. **`git push`** — 66 local commits across the whole overhaul are unpushed.
2. **Rename checklist** (do in lockstep — spec `…phase-5-design.md` §4):
   - Rename local folder `X:/playground/auto-checker` → `background-worker` (nothing holding the dir).
   - Rename the GitHub repo, then `git remote set-url origin …/background-worker.git`.
   - Then flip the coupled code refs: `lib/services.ts` `GITHUB_REPO_URL` + Northflank URL; README's `bryanbernigen/auto-checker` slug + `auto_checker` DB name; Northflank service + `DATABASE_URL` db name. (Doing these before the GitHub/Northflank renames would 404 the dashboard commit-footer + services links.)
3. **Browser smokes not yet done by user:** guest view (private window: masked, read-only, hidden jobs absent), `/dashboard/new` create flow, schedule-type switch re-arms countdown, contact form actually WhatsApps, the new **WAHA settings form** (edit URL/key/session, Send test), and the overall dark-theme visual pass.

## Resuming after the rename

Open the renamed folder, then: `git status` (confirm the 66 unpushed commits are intact),
`npx vitest run` (expect 128 passing), and read this file + the phase status memory.
The full phase specs/plans are in `docs/superpowers/`.
