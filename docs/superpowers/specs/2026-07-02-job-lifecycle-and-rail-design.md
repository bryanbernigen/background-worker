# Rail UX + Job Lifecycle (Archive/Delete) — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm) — ready for planning
**Builds on:** the merged background-worker app (Phases 1–5 + follow-ups).

## 1. Goals

1. **Fix the rail:** the left sidebar grows with the detail page so the pinned
   Settings/Logout scroll off. Make it fixed to the viewport, with the jobs list
   scrolling internally, plus a **search box** to filter jobs as the list grows.
2. **Job lifecycle:** let the admin **archive** a job (reversible soft-hide) and
   **permanently delete** an archived job. Archived jobs keep their row + run
   history + recipients and can be **unarchived**.

## 2. Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Rail height | Shell is exactly viewport height; jobs list scrolls independently; Settings/Logout/contact stay pinned at the bottom. |
| 2 | Job search | Client-side filter over the already-loaded jobs (title / type / slug). No backend. |
| 3 | Archive | Reversible soft-hide: stops scheduling, hidden from active rail, keeps row + history + recipients; unarchivable. |
| 4 | Delete | Permanent (existing hard delete, cascades). **Only exposed on already-archived jobs**, behind a confirm. |
| 5 | Archived view | Collapsible **"Archived (N)"** section in the rail (admin only). |
| 6 | Guests | Never see archived jobs (and they aren't running). |

## 3. Data Model — migration `0006_archive_jobs`

Add `jobs.archivedAt timestamptz null` (`archived_at`; null = active, set = archived).
No other changes. Hand-author the sql + snapshot + journal, validate with
`drizzle-kit generate` → "No schema changes".

## 4. Scheduler (`lib/scheduler/index.ts`)

Archived jobs must never run:
- `start()` arms only `enabled = true AND archived_at IS NULL`.
- `armTimer(jobId)` treats `archivedAt != null` exactly like `!enabled`: clear any
  timer and null `nextRunAt`, then return (so `reschedule` on an archived job is a no-op arm).
- Archiving calls `unschedule(jobId)`; unarchiving calls `reschedule(jobId)`.

## 5. API (admin-gated)

- **`POST /api/jobs/[slug]/archive`** — set `archived_at = now()`, `nextRunAt = null`,
  `unschedule(id)`. 404 if missing.
- **`POST /api/jobs/[slug]/unarchive`** — clear `archived_at`, `reschedule(id)`.
- **`DELETE /api/jobs/[slug]`** — unchanged permanent delete (UI restricts it to archived jobs).

Guest visibility guard extended in the read routes + job page: a guest may see a
job only when `visibleToGuest && archivedAt == null`; otherwise 404/notFound.
(Routes: `GET /api/jobs/[slug]`, `.../recipients`, `.../history`.)

## 6. Rail (`app/dashboard/rail.tsx`, client)

- Fixed full-height flex column: header, **search input**, scrollable jobs list
  (`flex-1 min-h-0 overflow-y-auto`), then pinned Settings/Logout/contact.
- The layout passes two role-filtered lists: `active` (archived_at null) and, for
  admins, `archived`.
- **Active list** = filtered by the search query via a pure `filterJobs(jobs, q)`.
- **Archived section** (admin, only when non-empty): a collapsible
  `▸ Archived (N)` toggle revealing the archived jobs (each links to its detail
  page; muted styling). Also filtered by the search query.

## 7. Console layout (`app/dashboard/layout.tsx`)

- Outer shell `min-h-screen` → `h-screen overflow-hidden`; `<main>` keeps
  `overflow-y-auto`.
- Query split: `active = where archived_at IS NULL` (role-filtered as today);
  `archived = where archived_at IS NOT NULL` (admin only, `[]` for guests).
  Pass both to `<Rail>`.

## 8. Job detail page (`app/dashboard/jobs/[slug]/page.tsx`)

- Guest + (archived or not visible) → `notFound()`.
- **Active job (admin):** existing controls + an **Archive** button.
- **Archived job (admin):** an "Archived" badge; **Unarchive** + **Delete
  permanently** (confirm) buttons; hide the run/enable/schedule/cookie controls
  (it's not running); recipients + history remain visible (read-only view of the past).

## 9. Testing

- Pure `filterJobs(jobs, query)` (matches title/type/slug, case-insensitive) — unit-tested.
- Migration applied + validated; full suite + `tsc` + build green.
- Manual: archive a job → leaves active list, appears under Archived, stops running;
  unarchive → returns and re-arms; delete from archived → gone; search filters both lists;
  rail Settings stays visible while the detail pane scrolls.

## 10. Out of Scope

- No bulk actions, no auto-archive, no retention policy. One archived section, manual only.
- No change to how jobs are created/scheduled beyond the archived guard.
