# Cookie Expiry Alert & Countdown — Design

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan

## Problem

The DataAnnotation job authenticates with a session cookie pasted into the
dashboard. When that session expires, scraping silently starts failing until
someone notices and pastes a fresh cookie. We want to:

1. Know the cookie's real expiry automatically (no manual entry, no guessing).
2. Send a WhatsApp warning ~24h before it expires, to a dedicated recipient list.
3. Show the expiry date and a live countdown in the dashboard.

## Key Discovery

The pasted `Cookie:` header carries **no** expiry — expiry only lives in
`Set-Cookie` response headers, which are not part of what the user pastes. The
one `expire=` value in a raw cookie header (`_dd_s`) is Datadog's rolling
~15-minute analytics session, not the auth lifetime.

However, the **HTML page the scraper already downloads** embeds the real session
expiry. In a dedicated element:

```
id="SessionExpirationBanner-hybrid-root" data-props="{...&quot;sessionExpiresAt&quot;:1782366605000...}"
```

`sessionExpiresAt` is an epoch-ms timestamp (the example fixture decodes to
2026-06-25 05:50 UTC). Because the scraper fetches and parses this page on every
run, we can read the true expiry automatically — no TTL assumption needed.

### Known behavior: sliding expiry

`sessionExpiresAt` appears to be an inactivity-based (sliding) timeout. Each
scrape request likely pushes it further out, so while polling is healthy the
countdown keeps extending and the 24h warning rarely fires — the cookie is being
kept alive. The warning therefore acts as a **safety net** for when the session
is actually killed (logout elsewhere, password change, or an absolute cap). Hard
auth failures (401/403) are already covered by the existing failure-streak alert
("Auth expired — please update cookie"). The everyday value of this feature is
the live countdown display; the warning is the backstop.

## Decisions (from brainstorming)

- **Expiry source:** read `sessionExpiresAt` live from the scraped HTML. If
  absent, show "No expiry detected yet" (no TTL fallback).
- **Recipients:** a list *separate* from the project-alert recipients.
- **Repeat policy:** warn **once** per cookie, ~24h before expiry.
- **Scheduling:** dedicated per-job expiry timer (approach A — see below).

## Architecture

### Data model

- **Migration:** add `kind text not null default 'project'` to the `recipients`
  table. Values: `project` (existing new-task alerts) | `cookie` (expiry
  warnings). This reuses the existing `RecipientsPanel` UI and per-recipient
  test-send, rendered twice on the job page (one per kind).
- **Cookie state** lives in the DataAnnotation job's `custom_settings` jsonb (no
  schema migration; these non-`_encrypted` keys already pass through to the
  client via the GET-job route convention):
  - `cookie_expires_at` — epoch ms read from the site, or absent/null.
  - `cookie_checked_at` — epoch ms; when expiry was last read (for "as of" UI).
  - `cookie_warned` — boolean; reset to `false` on every cookie save → gives
    "warn once per cookie".
  - `cookie_invalid` — boolean; set when a validation fetch is rejected (auth).

### Extraction

New function in the DataAnnotation job, e.g. `extractSessionExpiry(html): number | null`:

- Regex the `SessionExpirationBanner-hybrid-root` `data-props` for
  `sessionExpiresAt` and return the epoch-ms integer, or `null` if not found /
  unparseable.
- Called inside `runCheck` after a successful fetch. The result is persisted to
  `custom_settings` (`cookie_expires_at`, `cookie_checked_at`).

### Cookie-update flow ("auto check expiry on update")

When a cookie is saved via the settings route:

1. Encrypt + store the cookie (existing behavior).
2. Reset `cookie_warned = false`, clear `cookie_invalid`.
3. Trigger an **immediate validation fetch** by reusing the manual-run path. This
   confirms the new cookie works *and* captures `sessionExpiresAt` right away.
4. Re-arm the expiry timer from the freshly stored `cookie_expires_at`.
5. The settings panel refreshes and shows the new expiry + countdown instantly.

If the validation fetch is rejected (401/403), set `cookie_invalid`, surface
"cookie rejected" in the panel, and do not arm a timer.

### Scheduling (approach A — dedicated expiry timer)

Extend the in-process scheduler (`lib/scheduler`) with a second HMR-safe timer
map (`__expiryTimers`), parallel to the existing scrape-timer map:

- `armExpiryTimer(jobId)`:
  - Read the job's `custom_settings`. Compute `warnAt = cookie_expires_at − 24h`.
  - If `cookie_warned` is true or there is no `cookie_expires_at` → arm nothing.
  - If `warnAt` is in the past (and not warned) → fire immediately (boot
    catch-up).
  - Otherwise `setTimeout` to `warnAt`.
- **On fire:** send the WhatsApp message to all `kind='cookie'` recipients of the
  job, then set `cookie_warned = true` and clear the timer.
- **Re-armed** on boot (`start()`), on cookie save (`reschedule`-adjacent), and
  after any run whose `cookie_expires_at` changed.
- Runs **independently of `job.enabled`** — the user still wants expiry warnings
  even if scraping is paused.

Rejected alternatives: **B** piggyback on scrape runs (late/missed when paused or
outside the daily window); **C** a global periodic sweep (an always-on loop for a
single job).

### WhatsApp message

Sent via the existing `WahaClient`. Example:

```
⚠️ DataAnnotation cookie expires in ~24h (Jun 25, 12:50 PM).
Log in and paste a fresh cookie to keep monitoring running.
```

### UI — expiry + countdown

Inside the DataAnnotation cookie panel (`settings-panel.tsx`), below the
stored-cookie view:

- Absolute expiry date/time, plus "checked <relative time> ago".
- A **live countdown** ("Expires in 5d 23h 41m") ticking each second, mirroring
  the existing run `Countdown` component (same hydration-safe `now === null`
  pattern, reusing `formatDurationS`).
- Color: normal > 24h, amber < 24h, red if expired.
- When `cookie_expires_at` is absent: "No expiry detected yet — will populate on
  the next check."
- When `cookie_invalid`: "Cookie rejected — paste a fresh one."

The panel already polls `/api/jobs/data-annotation`; `cookie_expires_at`,
`cookie_checked_at`, `cookie_invalid` ride along in the `custom` passthrough.

### Error handling

- Validation fetch auth failure → `cookie_invalid`, no timer, panel surfaces it.
- Missing/garbage `sessionExpiresAt` → treat as null; countdown shows the
  "no expiry detected" state; no timer armed.
- WAHA send failure on warning → log and continue (do not set `cookie_warned`, so
  the next arm retries). Mirror existing per-recipient try/catch.

## Testing

- `extractSessionExpiry`: real fixture from `example_response.html` (asserts
  `1782366605000`), plus missing-element and malformed-JSON cases → null.
- Warn-time computation + state machine: `warnAt = expiry − 24h`; warn-once
  (no second send for same cookie even if expiry slides); boot catch-up when
  `warnAt` already passed and not warned.
- Cookie-save resets `cookie_warned` and re-arms.

## Out of scope

- Re-notifying after the single warning (explicitly "warn once").
- Parsing expiry from the pasted cookie header (not present there).
- Configurable TTL (moot — we read the real expiry).
