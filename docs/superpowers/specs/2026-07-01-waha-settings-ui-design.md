# WAHA Settings in the UI — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorm) — ready for implementation planning
**Builds on:** Phases 1–5 (merged to `main`). Reuses the Phase-3 `app_settings` table + `lib/crypto`.

## 1. Goal

Let the admin edit the WhatsApp/WAHA connection (URL, API key, session) from the
UI so a WAHA change needs no container restart. Store config in the DB, encrypt
the API key at rest, and show it masked (same pattern as the DataAnnotation
cookie). Keep env vars working as a fallback so the current deploy is untouched.

## 2. Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | DB vs env precedence | **DB overrides env; env is the fallback.** A field set via UI wins; unset fields read the env var. Zero-migration. |
| 2 | API key at rest | **Encrypted** with `lib/crypto` (same as the cookie); never sent raw to the client — only a masked preview. |
| 3 | URL / session | Shown/edited in the clear (not secret). |
| 4 | Fields | `waha_url`, `waha_api_key` (encrypted), `waha_session`. |
| 5 | Root secret | The `lib/crypto` key stays in env (bootstrap secret); everything derived is DB-configurable. |

## 3. Storage (`app_settings`, existing table)

Reuse the Phase-3 `app_settings` key/value table and its `{ v }` wrapper (via the
existing `getSetting`/`setSetting` helpers in `lib/access/settings.ts`). Keys:

- `waha_url` — string
- `waha_api_key_encrypted` — ciphertext string (from `encrypt()`)
- `waha_session` — string

No migration required.

## 4. Config resolver — `lib/waha-config.ts`

Central async accessor so every call site stops reading env directly.

- `resolveWaha(dbVal: string | null | undefined, envVal: string | undefined): string | null` —
  **pure** precedence helper (DB non-empty wins, else env, else null). Unit-tested.
- `getWahaConfig(): Promise<{ url: string | null; apiKey: string; session: string }>` —
  reads each DB key (via `lib/access/settings` accessors), applies `resolveWaha`
  against the matching env var, and `decrypt()`s the stored key (falling back to
  `WAHA_API_KEY`). `session` defaults to `'default'` when neither source set.
- `getWahaChannel(): Promise<NotificationChannel | null>` — builds the
  `WahaClient`-backed channel from `getWahaConfig()`; `null` when `url` is null.
  Replaces `wahaChannelFromEnv()`.
- `wahaConfigStatus(): Promise<{ configured: boolean; url: string | null; urlSource: 'db'|'env'|'none'; apiKeyPreview: string | null; apiKeySource: 'db'|'env'|'none'; session: string }>` —
  for the settings page; `apiKeyPreview` is masked (`front4…back4 (N chars)`), never the raw key.

`lib/access/settings.ts` gains typed accessors: `getWahaUrl/setWahaUrl`,
`getWahaApiKeyEncrypted/setWahaApiKey` (encrypts on set; clears the row on null),
`getWahaSession/setWahaSession` — thin wrappers over `getSetting/setSetting`.

## 5. Refactor call sites to the resolver

Replace direct env reads / `wahaChannelFromEnv()` with `await getWahaChannel()` /
`await getWahaConfig()`:

- `lib/notify.ts` — drop `wahaChannelFromEnv` (env-only); the DB-aware `getWahaChannel`
  lives in `lib/waha-config.ts`. `buildNotifier` is unchanged (still takes a channel).
- `lib/scheduler/index.ts` — `executeRun` (notifier build) + `fireExpiryWarning`
  (its own `WahaClient`) → `await getWahaChannel()` / `getWahaConfig()`.
- `app/api/contact/route.ts`, `app/api/settings/notifications/test/route.ts`,
  `app/api/jobs/[slug]/recipients/[id]/test/route.ts` → `await getWahaChannel()`.
- `app/api/health/route.ts` → `getWahaConfig()` for url/apiKey/session on the status check.
- `app/dashboard/layout.tsx` + notifications page → use `wahaConfigStatus().configured`
  instead of `!!process.env.WAHA_URL`.

## 6. API — `/api/settings/notifications` (new route.ts; admin)

- **`GET`** → `wahaConfigStatus()` (masked). 
- **`PATCH`** → body `{ wahaUrl?: string | null; wahaApiKey?: string | null; wahaSession?: string | null }`:
  - `wahaApiKey` **omitted/blank ⇒ keep the existing key** (cookie pattern); a
    non-empty value is `encrypt()`ed and stored; explicit `null` clears it (→ env fallback).
  - `wahaUrl`/`wahaSession`: set when non-empty; empty/`null` clears the row (→ env fallback).
  - Admin-gated (`requireAdmin`). Zod-validated, `.strict()`.

The existing `POST /api/settings/notifications/test` stays (now uses `getWahaChannel`).

## 7. Notifications settings page (form)

Replace the read-only status block with an editable admin form:

- **WAHA URL** — text (shown in full) + a source hint (`set here` / `from env` / `not set`).
- **API key** — masked preview + a "leave blank to keep, paste to replace" input
  (exactly like the cookie); source hint.
- **Session** — text (default `default`).
- Save → `PATCH /api/settings/notifications`; keep the **Send test** button.

## 8. Security & Testing

- API key encrypted at rest; only a masked preview crosses the wire.
- Unit tests (pure): `resolveWaha` precedence (db wins / env fallback / none);
  `maskSecret` preview formatting; the PATCH "blank key keeps existing" merge helper.
- `tsc --noEmit` + `npm run build` + full Vitest suite green. Manual: edit WAHA in
  the UI, Send test, confirm delivery without a restart.

## 9. Out of Scope

- No new notification channels (WhatsApp/WAHA only).
- No change to how the `lib/crypto` key is provisioned (stays env).
- The Phase-5 external-rename checklist is unaffected.

## 10. Open Questions

None. (URL shown in clear; only the API key is masked, per approval.)
