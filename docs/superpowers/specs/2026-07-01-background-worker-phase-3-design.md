# Background Worker — Phase 3 Design: Access Control & PII Masking

**Date:** 2026-07-01
**Status:** Approved (brainstorm) — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-background-worker-platform-design.md` (§7)
**Builds on:** Phases 1 & 2 (merged to `main`).

## 1. Goal

Add a two-tier access model: one **admin** (full control) and a public read-only
**guest** tier with server-side PII masking and per-job visibility. Guest access is
an open, admin-togglable read-only view suited to a shareable portfolio link. No
new UI redesign (that is Phase 4) — Phase 3 builds the mechanism end-to-end and
makes today's pages safe and coherent for guests.

## 2. Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | How one becomes a guest | **Open read-only**, gated by an admin toggle. Tokenless visitor + guest-mode ON → `guest`; guest-mode OFF → redirect to login. Admin login unchanged. |
| 2 | Guest recipient view | **Masked name AND masked phone.** Name = first+last char (`Bryan`→`B***n`; ≤2 chars → all `*`). Phone = keep last 4 (`••••7890`). |
| 3 | Secrets to guests | **Never sent.** Secret previews (`*_preview`), cookie state, and job `customSettings` are omitted for guests. |
| 4 | Run history for guests | Show the run **list** (status, trigger, `summary`, timing, notified). **Withhold** drill-down detail (`data`, `rawHtml`, `errorMessage`). |
| 5 | Enforcement | **Server-side only.** Guests never receive raw PII in any API/RSC payload; masking in the browser is rejected. |
| 6 | Guest-mode flag storage | Minimal `app_settings` key-value table (runtime-togglable); default guest-mode **ON**. |
| 7 | Guest token | **None.** Guest is the derived role for a tokenless visitor; only admins get a session token. |

## 3. Roles & Role Resolution

- `SessionPayload` gains `role: 'admin' | 'guest'`. `createSessionToken(username, role)` embeds it; the admin login issues `role: 'admin'`. Existing tokens (no `role`) are treated as `admin` on verify (backward-compatible — only admins ever had tokens).
- New module `lib/access/role.ts`:
  - `resolveRole(): Promise<'admin' | 'guest' | null>` (Node, DB-aware): valid admin token → `admin`; else if guest-mode enabled → `guest`; else `null`.
  - `requireAdmin()` — `{ ok: true; role: 'admin' } | { ok: false; res }` (401/403) for mutations.
  - `requireViewer()` — `{ ok: true; role } | { ok: false; res }` (admin or guest; 401/redirect when `null`) for reads.
- `lib/api/require-session.ts` is retained but re-expressed in terms of the above (admin-gate) so existing route imports keep working.

## 4. Guest-mode Flag — `app_settings` table (migration `0004a`)

```ts
export const appSettings = pgTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- `lib/access/settings.ts`: `isGuestModeEnabled(): Promise<boolean>` (reads row `guest_mode`, **defaults to `true`** when absent) and `setGuestMode(on: boolean): Promise<void>`.
- **`PATCH /api/settings/access`** (admin-only): body `{ guestMode: boolean }` → `setGuestMode`.
- **`GET /api/settings/access`** (admin-only): returns `{ guestMode }`.

## 5. Per-job Visibility — migration `0004b`

- Add `jobs.visibleToGuest boolean not null default true`.
- Guest-facing reads **filter server-side**:
  - dashboard job list: exclude `visibleToGuest = false`;
  - job detail page: hidden job → `notFound()` for guests;
  - `history` / `recipients` / `run` / `settings` GET APIs: hidden job → 404 for guests.
- Admin: sees and manages all jobs. Toggled via the settings PATCH route (extend Task in plan) or the create payload (optional `visibleToGuest`).

> Migrations `0004a` (app_settings) and `0004b` (jobs.visibleToGuest) may be authored as one drizzle migration file `0004_access_control`; the "a/b" split is conceptual.

## 6. Server-side Masking — `lib/access/mask.ts`

A single boundary applied in every read path that serves sensitive data:

```ts
export function maskName(name: string): string;   // 'Bryan' -> 'B***n'
export function maskPhone(phone: string): string; // keep last 4 -> '••••7890'
export function maskRecipient(role, r): Recipient;         // guest: name+phone masked
export function maskRunDetail(role, row): RunRow;          // guest: drop data/rawHtml/errorMessage
export function maskJobCustom(role, custom): unknown;      // guest: omit previews/secrets/customSettings
```

- **Recipients** (list + any single-recipient response): guest → `maskName`/`maskPhone`.
- **Run history list**: unchanged fields for both roles (`summary` etc. are safe). **Run detail** (`detailId` path): guest → `data`/`rawHtml`/`errorMessage` stripped.
- **Job settings GET**: guest → `custom`/previews omitted entirely.
- Admin → identity (no masking).

## 7. Write Protection (defense in depth)

- **Middleware (edge, DB-free):** for mutating methods (`POST`/`PATCH`/`PUT`/`DELETE`) on `/api/*`, require a valid admin token (crypto-only check), else `403` — **except the auth routes** (`/api/auth/login`, `/api/auth/logout`), which must stay open so an unauthenticated user can sign in. `GET` and page requests pass through (role resolved in the Node layer). Page-level login redirect for `null` role moves into the pages/layout (they can read the DB).
- **Route handlers:** every mutating route calls `requireAdmin()`; every read route calls `requireViewer()` and applies masking + visibility. Belt-and-suspenders with middleware.

Mutating routes to guard: `POST /api/jobs`, `DELETE /api/jobs/[slug]`, `PATCH /api/jobs/[slug]/settings`, `POST /api/jobs/[slug]/run`, recipients `POST`/`PUT`/`DELETE`/`test`, `PATCH /api/settings/access`.

## 8. Current-UI Wiring (minimal; polish is Phase 4)

Server components resolve role and adapt:
- **Dashboard:** guest → only `visibleToGuest` jobs, masked, no Logout-only header tweaks; hide nothing structural.
- **Job page:** guest → hide admin action controls (Run now, Pause/Enable toggle, Edit header, Delete, schedule form, recipients add/edit/delete, cookie settings panel); render masked recipients and run history; hidden job → `notFound()`.
- A small `role` prop threads into the client components that render action controls; guests get read-only renders.
- The polished Split Console guest experience is Phase 4; Phase 3 only ensures the current pages present safely and correctly to guests.

## 9. Testing (TDD)

- `mask.ts`: `maskName` (normal, ≤2 chars, empty), `maskPhone` (long, short), `maskRecipient`/`maskRunDetail`/`maskJobCustom` for both roles.
- `role.ts`: `resolveRole` (valid admin token → admin; no token + guest-mode on → guest; no token + guest-mode off → null); `requireAdmin` rejects guest/null; `requireViewer` accepts admin+guest, rejects null.
- `settings.ts`: `isGuestModeEnabled` default-true when unset; round-trips `setGuestMode`.
- Visibility: guest-facing job query excludes hidden jobs; admin includes them.
- Route guards: a representative mutating route 403s without an admin token; a read route returns masked data for guests.
- Full suite + `tsc --noEmit` + `npm run build` green; admin flows unchanged.

## 10. Out of Scope (later phases)

- Split Console redesign / polished guest UX — **Phase 4**.
- Project/repo rename + cleanup — **Phase 5**.
- Multi-user accounts, more than two roles, per-field ACLs — non-goals.
- Notification-settings UI (WAHA status/test) — Phase 4 (though `app_settings` introduced here will host it).

## 11. Open Questions

None outstanding — parent spec §12.2 (guest auth) resolved as open read-only + toggle.
