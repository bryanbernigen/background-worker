# Page Restructuring Design

## Goal

Restructure the app into three levels: Dashboard Home, Checker Pages, and Global Settings.

## Architecture

### URL Structure
- `/dashboard` → Home — grid of checker cards
- `/dashboard/data-annotation` → Data Annotation checker page
- `/dashboard/settings` → Global settings

### Pages

**Dashboard Home (`/dashboard`)**
Grid of cards, one per enabled checker. Each card shows:
- Checker name (e.g. "Data Annotation")
- Status badge (sleeping/running/error/no_cookie)
- Quick "Run Check Now" button

Behavior: clicking a card navigates to `/dashboard/<slug>`.

**Checker Page (`/dashboard/data-annotation`)**
Checker-specific content — current dashboard content moved here:
- Status (countdown, last checked, checker status)
- Recent Activity
- Checker-specific settings (cookie, WhatsApp recipient, send test)
- Run Check Now button

**Global Settings (`/dashboard/settings`)**
App-wide defaults:
- Timezone offset (number input, default 7)
- Check window: start hour (default 7) and end hour (default 23)
- WhatsApp recipient and test (can also be set per-checker, but this is the default)

## Files to Change

| File | Action |
|------|--------|
| `app/dashboard/page.tsx` | Replace with grid of checker cards |
| `app/dashboard/data-annotation/page.tsx` | Create — move current dashboard content |
| `app/dashboard/settings/page.tsx` | Create — global settings with timezone |
| `components/dashboard-cards.tsx` | Move to checker page content |
| `components/settings-form.tsx` | Move to settings page, keep per-checker fields |
| `app/api/status/route.ts` | Add timezone info to response |
| `app/api/settings/route.ts` | Add timezone CRUD |
| `app/api/settings/timezone/route.ts` | Create — timezone API |

## Data Model

**Settings stored in Redis:**
- `app_settings` — JSON: `{ timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23, defaultWaRecipient: '' }`

## No placeholders, no TODOs. This spec is complete.
