# Background Worker — Phase 4 Design: Split Console UI + Dark Theme

**Date:** 2026-07-01
**Status:** Approved (brainstorm) — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-background-worker-platform-design.md` (§9)
**Builds on:** Phases 1–3 (merged to `main`).

## 1. Goal

Overhaul the UI into a dark "Split Console" (persistent left rail + right detail
pane) matching the portfolio's dark/cyan theme, add the admin **submit-a-job** UI
(the Phase 2 create API has no UI yet), and add **Settings** (Notifications,
Access). No new backend endpoints — Phase 4 is UI over the Phase 1–3 APIs. All
views are role-aware, reusing Phase 3's server-side `resolveRole`/masking/visibility.

## 2. Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Console structure | **Persistent rail** via `app/dashboard/layout.tsx`; right pane = routed page (`/dashboard` welcome, `/dashboard/jobs/[slug]`, `/dashboard/new`, `/dashboard/settings/*`). |
| 2 | Submit-a-job surface | **Dedicated route** `/dashboard/new` rendered in the detail pane. |
| 3 | Theme | Portfolio dark/cyan palette as CSS vars + Tailwind v4 `@theme`; Inter body, mono uppercase micro-labels. Login page themed too. |
| 4 | Components | **Reuse** the existing per-job client components, restyled; build new shell (rail, welcome, new-job, settings) components. |
| 5 | Notifications "Send test" | Targets `admin_contact_phone` (from Phase 3 `app_settings`) when set; disabled/hint when unset. |
| 6 | Role behavior | Reuse Phase 3 server-side enforcement; the UI only *hides* controls guests can't use (never the sole guard). |

## 3. Design System (dark theme)

In `app/globals.css`, replace the light `:root` with the dark tokens and expose
them through Tailwind v4 `@theme`:

- `--color-bg #0e0f13`, `--color-surface #16181f`, `--color-surface-2 #1d2029`,
  `--color-border #2a2e3a`, `--color-text #e7e9ee`, `--color-muted #9aa3b2`,
  `--color-accent #22d3ee`.
- Status: `--color-ok #34d399`, `--color-warn #fbbf24`, `--color-error #f87171`,
  `--color-off #52525b`.
- Fonts: Inter (body, existing `--font-inter`), monospace for uppercase
  micro-labels (Tailwind `font-mono`).

Restyle `components/ui/{button,card,badge,input}.tsx` and `components/login-form.tsx`
+ the login page (`app/page.tsx` if present) to the dark theme. Add a small
`components/ui/status-dot.tsx` mapping a run status (`ok|error|skipped|idle`) →
token color, reused by the rail and history.

## 4. Console Shell

- **`app/dashboard/layout.tsx`** (server component): `resolveRole()` → redirect to
  `/` when `null`; render a two-column shell — `<Rail role=… />` (left) and
  `{children}` (right detail pane) inside the dark background. The layout fetches
  the role-filtered job list for the rail.
- **`/dashboard` (welcome pane):** brief intro card + the existing "Services &
  Accounts" list + build footer (moved out of the old dashboard page). This is the
  empty/landing state of the detail pane.

## 5. Rail (`app/dashboard/rail.tsx`)

- **Jobs** (role-filtered server-side): each item = `StatusDot` (latest run status)
  + title + a mono sub-label (`type · schedule`); the active job (matched by slug
  from the URL) is highlighted with the accent. Links to `/dashboard/jobs/[slug]`.
  - Latest-run status per job is fetched in the layout (one query per job, as the
    old dashboard did) and passed to the rail.
- **Admin extras:** a `＋ New job` link (→ `/dashboard/new`), a `🔒` marker on jobs
  with `visibleToGuest = false`, and a **Settings** section (links: Notifications,
  Access).
- **Guest:** no `＋`/Settings; a pinned "Request full access" control in the rail
  footer (the Phase 3 `ContactAdmin` form) shown only when configured
  (`admin_contact_phone` set + `WAHA_URL`).

## 6. Job Detail Pane (`/dashboard/jobs/[slug]`)

Restyle the existing page into the dark pane, reusing Phase 3 role gating
(guest → masked, read-only, no action controls, hidden-job `notFound()`):

- Header (`editable-header` for admin; static for guest), `countdown`, and admin
  actions (`run-now-button`, `enable-toggle`).
- `schedule-form` — **extend** to choose `scheduleType` (window | interval | cron)
  and show the matching fields (window: min/max/day-hours/tz; interval: intervalS;
  cron: cronExpr + tz), submitting to the existing settings PATCH.
- DA `CustomSettingsPanel` (admin only), `recipients-panel` (role-aware, restyled),
  `history-table` (restyled; `StatusDot`; detail masked for guests).

## 7. Submit-a-job (`/dashboard/new`, admin)

Server component guards admin (`resolveRole` → non-admin `notFound()`), fetches the
type catalog (`listJobTypes()` directly, server-side), and renders a client form:

- Pick **type** (radio/select from catalog).
- **Name**; **schedule** (a `ScheduleFields` component: type selector + matching
  params); **guest visibility** checkbox; optional **recipients** rows.
- Submit → `POST /api/jobs` → on success redirect to `/dashboard/jobs/<slug>`.
- Client validation mirrors `createJobSchema` shape; server remains the source of truth.

## 8. Settings (admin, detail pane)

- **`/dashboard/settings/notifications`:** server-fetch WAHA status via the health
  check (reuse the health route's logic or call `GET /api/health` server-side with
  the session); show sender status + a client "Send test" button (POST to a small
  action that sends to `admin_contact_phone`; disabled with a hint when unset) +
  static re-scan-QR guidance. **If a new endpoint is required for "send test", it is
  the only backend addition** — otherwise reuse existing recipient-test plumbing.
- **`/dashboard/settings/access`:** client form bound to `GET/PATCH /api/settings/access`
  (Phase 3): guest-mode on/off toggle + `admin_contact_phone` text field.

Both are admin-only (layout already redirects `null`; these pages additionally
`notFound()` for guests).

## 9. Guest Experience

Same shell and detail pages; rail shows only `visibleToGuest` jobs, no action
controls, PII masked — all already enforced server-side in Phase 3. Hidden jobs
never render. The rail's "Request full access" form is the guest's primary CTA.

## 10. Testing

- Unit-test extractable logic: `StatusDot` color mapping; a `scheduleFieldsToPayload`
  / `payloadToScheduleFields` mapping used by `/dashboard/new` and `schedule-form`
  (mirrors `createJobSchema`'s discriminated schedule); any client-side validation
  helper.
- `npm run build` + `tsc --noEmit` green; full existing suite stays green.
- Visual polish verified by eye (manual pass), not asserted in tests.
- The **frontend-design** skill guides the aesthetic execution during implementation.

## 11. Out of Scope

- Project/repo rename (`auto-checker` → `background-worker`) + root cleanup — **Phase 5**.
- New job *types* or scheduling features — none; DataAnnotation unchanged.
- Additional notification channels — WhatsApp only (as established).

## 12. Open Questions

None outstanding. (Notifications "Send test" target resolved as `admin_contact_phone`;
a minimal send-test endpoint may be added if no existing route fits — the only
possible backend touch in this phase.)
