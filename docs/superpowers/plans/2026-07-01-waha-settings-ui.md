# WAHA Settings in the UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use `- [ ]` checkboxes.

**Goal:** Make WAHA (WhatsApp) URL / API key / session editable from the admin UI, stored in the DB (key encrypted, shown masked), with env vars as fallback — no container restart to change them.

**Architecture:** A DB-over-env resolver in `lib/waha-config.ts` (`getWahaConfig`/`getWahaChannel`/`wahaConfigStatus`) becomes the single source every call site uses instead of reading `process.env.WAHA_*`. `lib/access/settings.ts` gains generic string accessors for storage; `lib/crypto` encrypts the key. A new `GET/PATCH /api/settings/notifications` + a form on the Notifications page drive it.

**Tech Stack:** Next.js 16 (RSC + route handlers), TypeScript, Drizzle, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-waha-settings-ui-design.md`.

## Global Constraints

- DB value wins when set; else env fallback; else null. Existing env deploys keep working untouched.
- API key encrypted at rest (`lib/crypto`); only a masked preview crosses the wire (cookie pattern). URL + session are not secret.
- No new table (reuse `app_settings` + its `{v}` wrapper). No new env requirements.
- Admin-only for the settings API/page (`requireAdmin`). Read APIs never leak the raw key.
- TDD for pure helpers; `tsc --noEmit` + `npm run build` + full suite green at the end.
- Commit per task; trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Config resolver `lib/waha-config.ts` + generic settings accessors

**Files:**
- Modify: `lib/access/settings.ts` (add generic string accessors)
- Create: `lib/waha-config.ts`, `lib/waha-config.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`setSetting` (private in settings.ts) via new exports; `encrypt`/`decrypt` (`@/lib/crypto`); `WahaClient` (`@/lib/waha`); `NotificationChannel` (`@/lib/notify`).
- Produces (settings.ts): `getStringSetting(key: string): Promise<string | null>`; `setStringSetting(key: string, value: string | null): Promise<void>` (null → delete row).
- Produces (waha-config.ts):
  - `resolveWaha(dbVal: string | null | undefined, envVal: string | undefined): string | null` (pure)
  - `maskSecret(s: string): string` (pure — `front4…back4 (N chars)`, or all `*` when ≤8)
  - `apiKeyPatchAction(incoming: string | null | undefined): 'keep' | 'clear' | { set: string }` (pure)
  - `getWahaConfig(): Promise<{ url: string | null; apiKey: string; session: string }>`
  - `getWahaChannel(): Promise<NotificationChannel | null>`
  - `wahaConfigStatus(): Promise<{ configured: boolean; url: string | null; urlSource: Source; apiKeyPreview: string | null; apiKeySource: Source; session: string }>` where `type Source = 'db' | 'env' | 'none'`

- [ ] **Step 1: Add generic accessors to `lib/access/settings.ts`**

After the existing `setSetting` (keeping it and everything else), export:

```ts
export async function getStringSetting(key: string): Promise<string | null> {
  const v = await getSetting(key);
  return typeof v === 'string' && v.length > 0 ? v : null;
}
export async function setStringSetting(key: string, value: string | null): Promise<void> {
  if (value === null || value === '') {
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return;
  }
  await setSetting(key, value);
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/waha-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveWaha, maskSecret, apiKeyPatchAction } from './waha-config';

describe('resolveWaha', () => {
  it('DB value wins', () => { expect(resolveWaha('https://db', 'https://env')).toBe('https://db'); });
  it('falls back to env when DB unset/empty', () => {
    expect(resolveWaha(null, 'https://env')).toBe('https://env');
    expect(resolveWaha('', 'https://env')).toBe('https://env');
    expect(resolveWaha(undefined, 'https://env')).toBe('https://env');
  });
  it('null when neither set', () => { expect(resolveWaha(null, undefined)).toBeNull(); });
});

describe('maskSecret', () => {
  it('masks long secrets front/back', () => { expect(maskSecret('abcdefghijklmnop')).toBe('abcd…mnop (16 chars)'); });
  it('fully masks short secrets', () => { expect(maskSecret('abc')).toBe('***'); });
});

describe('apiKeyPatchAction', () => {
  it('keeps when omitted', () => { expect(apiKeyPatchAction(undefined)).toBe('keep'); });
  it('clears on null or empty', () => {
    expect(apiKeyPatchAction(null)).toBe('clear');
    expect(apiKeyPatchAction('')).toBe('clear');
  });
  it('sets on a value', () => { expect(apiKeyPatchAction('secret')).toEqual({ set: 'secret' }); });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run lib/waha-config.test.ts`
Expected: FAIL — `./waha-config` missing.

- [ ] **Step 4: Implement `lib/waha-config.ts`**

```ts
import { WahaClient } from '@/lib/waha';
import { encrypt, decrypt } from '@/lib/crypto';
import type { NotificationChannel } from '@/lib/notify';
import { getStringSetting, setStringSetting } from '@/lib/access/settings';

type Source = 'db' | 'env' | 'none';

const KEY_URL = 'waha_url';
const KEY_APIKEY = 'waha_api_key_encrypted';
const KEY_SESSION = 'waha_session';

/** DB value wins when non-empty; else env; else null. Pure. */
export function resolveWaha(dbVal: string | null | undefined, envVal: string | undefined): string | null {
  if (dbVal && dbVal.length > 0) return dbVal;
  if (envVal && envVal.length > 0) return envVal;
  return null;
}

/** Masked preview of a secret — `front4…back4 (N chars)`, or all `*` when short. Pure. */
export function maskSecret(s: string): string {
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
}

/** What a PATCH should do with an incoming apiKey field. Pure. */
export function apiKeyPatchAction(incoming: string | null | undefined): 'keep' | 'clear' | { set: string } {
  if (incoming === undefined) return 'keep';
  if (incoming === null || incoming === '') return 'clear';
  return { set: incoming };
}

async function urlWithSource(): Promise<[string | null, Source]> {
  const dbVal = await getStringSetting(KEY_URL);
  if (dbVal) return [dbVal, 'db'];
  const env = process.env.WAHA_URL;
  return env ? [env, 'env'] : [null, 'none'];
}

async function apiKeyWithSource(): Promise<[string, Source]> {
  const enc = await getStringSetting(KEY_APIKEY);
  if (enc) { try { return [decrypt(enc), 'db']; } catch { /* fall through */ } }
  const env = process.env.WAHA_API_KEY;
  return env ? [env, 'env'] : ['', 'none'];
}

export async function getWahaConfig(): Promise<{ url: string | null; apiKey: string; session: string }> {
  const [url] = await urlWithSource();
  const [apiKey] = await apiKeyWithSource();
  const session = resolveWaha(await getStringSetting(KEY_SESSION), process.env.WAHA_SESSION) ?? 'default';
  return { url, apiKey, session };
}

export async function getWahaChannel(): Promise<NotificationChannel | null> {
  const { url, apiKey } = await getWahaConfig();
  if (!url) return null;
  const waha = new WahaClient(url, apiKey);
  return { sendText: (to, msg) => waha.sendText(to, msg) };
}

export async function wahaConfigStatus(): Promise<{
  configured: boolean; url: string | null; urlSource: Source;
  apiKeyPreview: string | null; apiKeySource: Source; session: string;
}> {
  const [url, urlSource] = await urlWithSource();
  const [apiKey, apiKeySource] = await apiKeyWithSource();
  const session = resolveWaha(await getStringSetting(KEY_SESSION), process.env.WAHA_SESSION) ?? 'default';
  return {
    configured: !!url,
    url, urlSource,
    apiKeyPreview: apiKey ? maskSecret(apiKey) : null,
    apiKeySource,
    session,
  };
}

/** Apply a settings PATCH to the WAHA config rows. */
export async function applyWahaPatch(patch: { wahaUrl?: string | null; wahaApiKey?: string | null; wahaSession?: string | null }): Promise<void> {
  if (patch.wahaUrl !== undefined) await setStringSetting(KEY_URL, patch.wahaUrl);
  if (patch.wahaSession !== undefined) await setStringSetting(KEY_SESSION, patch.wahaSession);
  const action = apiKeyPatchAction(patch.wahaApiKey);
  if (action === 'clear') await setStringSetting(KEY_APIKEY, null);
  else if (action !== 'keep') await setStringSetting(KEY_APIKEY, encrypt(action.set));
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/waha-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/access/settings.ts lib/waha-config.ts lib/waha-config.test.ts
git commit -m "feat(waha): DB-over-env config resolver (encrypted key, masked preview)"
```

---

### Task 2: Refactor call sites to the resolver

Replace every direct `process.env.WAHA_*` read / `wahaChannelFromEnv()` with the DB-aware resolver.

**Files:** `lib/notify.ts`, `lib/scheduler/index.ts`, `app/api/contact/route.ts`, `app/api/settings/notifications/test/route.ts`, `app/api/jobs/[slug]/recipients/[id]/test/route.ts`, `app/api/health/route.ts`, `app/dashboard/layout.tsx`, `app/dashboard/settings/notifications/page.tsx`

- [ ] **Step 1: `lib/notify.ts` — drop the env-only channel**

Remove `wahaChannelFromEnv` and its `WahaClient` import; keep `NotificationChannel` + `buildNotifier`:

```ts
import type { Notify, Recipient } from '@/lib/jobs/types';

export interface NotificationChannel {
  sendText(to: string, msg: string): Promise<boolean>;
}

/** Build a Notify that fans a message out to recipients (optionally filtered by tag). */
export function buildNotifier(recipients: Recipient[], channel: NotificationChannel | null): Notify {
  return async (message, opts) => {
    if (!channel) return false;
    const targets = opts?.tag ? recipients.filter(r => r.tag === opts.tag) : recipients;
    let sent = false;
    for (const r of targets) {
      try { sent = (await channel.sendText(r.phone, message)) || sent; }
      catch (e) { console.error(`[notify] send failed for ${r.phone}`, e); }
    }
    return sent;
  };
}
```

- [ ] **Step 2: `lib/scheduler/index.ts`**

Update the import line (currently `import { buildNotifier, wahaChannelFromEnv } from '@/lib/notify';`):

```ts
import { buildNotifier } from '@/lib/notify';
import { getWahaChannel } from '@/lib/waha-config';
```

In `executeRun`, the notifier build becomes:

```ts
    const notify = buildNotifier(
      recps.map(r => ({ id: r.id, name: r.name, phone: r.phone, tag: r.tag })),
      await getWahaChannel(),
    );
```

In `fireExpiryWarning`, replace the `const wahaUrl = process.env.WAHA_URL; if (wahaUrl && recps.length) { const waha = new WahaClient(...); ... }` block with a channel:

```ts
    const channel = await getWahaChannel();
    if (channel && recps.length) {
      const msg = formatExpiryWarning(job, expiresAt);
      let anySent = false;
      for (const r of recps) {
        try { anySent = (await channel.sendText(r.phone, msg)) || anySent; }
        catch (e) { console.error(`[scheduler] cookie-expiry send failed for ${r.phone}`, e); }
      }
      if (!anySent) return;
    }
```

Remove the now-unused `WahaClient` import from the scheduler if nothing else uses it (check with `grep -n WahaClient lib/scheduler/index.ts`; `maybeAlertFailureStreak` also builds one — convert it too):

In `maybeAlertFailureStreak`, replace its `const wahaUrl = process.env.WAHA_URL; if (!wahaUrl) return; const waha = new WahaClient(...)` with:

```ts
  const channel = await getWahaChannel();
  if (!channel) return;
```
and change the send loop to `await channel.sendText(r.phone, msg)`. After this, remove the `WahaClient` import from the scheduler.

- [ ] **Step 3: Contact + test routes**

`app/api/contact/route.ts` and `app/api/settings/notifications/test/route.ts`: replace `import { wahaChannelFromEnv } from '@/lib/notify';` → `import { getWahaChannel } from '@/lib/waha-config';` and `const channel = wahaChannelFromEnv();` → `const channel = await getWahaChannel();`.

`app/api/jobs/[slug]/recipients/[id]/test/route.ts`: replace the env/`WahaClient` block with:

```ts
import { getWahaChannel } from '@/lib/waha-config';
```
```ts
  const channel = await getWahaChannel();
  if (!channel) return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 500 });
  try {
    const ok = await channel.sendText(row.phone, `✅ Test message from ${job.title} (background-worker)`);
    if (!ok) return NextResponse.json({ error: 'WAHA returned non-OK' }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
```
(Remove the `WahaClient` import there.)

- [ ] **Step 4: Health route**

In `app/api/health/route.ts`, replace the WAHA block (lines ~22–32) to source config from the resolver:

```ts
  const { url: wahaUrl, apiKey: wahaKey, session: wahaSession } = await getWahaConfig();
  const waha = { configured: !!wahaUrl, reachable: false, status: null as string | null, account: null as string | null };
  if (wahaUrl) {
    try {
      const s = await new WahaClient(wahaUrl, wahaKey).getSessionStatus(wahaSession);
      waha.reachable = true;
      waha.status = s.status;
      waha.account = s.me?.pushName ?? s.me?.id ?? null;
    } catch { /* unreachable */ }
  }
```
Add `import { getWahaConfig } from '@/lib/waha-config';` (keep the `WahaClient` import — still used here).

- [ ] **Step 5: Layout + notifications page "configured" checks**

`app/dashboard/layout.tsx`: replace `!!process.env.WAHA_URL` in `contactEnabled` with a resolver check. Add `import { getWahaConfig } from '@/lib/waha-config';` and:

```ts
  const contactEnabled = !isAdmin && !!(await getAdminContactPhone()) && !!(await getWahaConfig()).url;
```

`app/dashboard/settings/notifications/page.tsx`: this page is fully replaced in Task 4 — leave it for now (it still reads `process.env.WAHA_URL`, which keeps working via env until Task 4).

- [ ] **Step 6: Verify no stray env reads + build**

Run: `grep -rn "wahaChannelFromEnv\|process.env.WAHA_" lib app --include=*.ts --include=*.tsx | grep -v waha-config.ts`
Expected: only the notifications *page* (still to be replaced in Task 4) and possibly none else. `lib/waha-config.ts` legitimately reads env.

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add lib/notify.ts lib/scheduler/index.ts app/api/contact/route.ts app/api/settings/notifications/test/route.ts "app/api/jobs/[slug]/recipients/[id]/test/route.ts" app/api/health/route.ts app/dashboard/layout.tsx
git commit -m "refactor(waha): read connection from DB-over-env resolver everywhere"
```

---

### Task 3: `GET/PATCH /api/settings/notifications`

**Files:** Create `app/api/settings/notifications/route.ts`

**Interfaces:** Consumes `requireAdmin`, `wahaConfigStatus`/`applyWahaPatch` (Task 1).

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/access/role';
import { wahaConfigStatus, applyWahaPatch } from '@/lib/waha-config';

export async function GET() {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  return NextResponse.json(await wahaConfigStatus());
}

const patch = z.object({
  wahaUrl:     z.string().url().nullable().optional(),
  wahaApiKey:  z.string().nullable().optional(),
  wahaSession: z.string().min(1).nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const parsed = patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  await applyWahaPatch(parsed.data);
  return NextResponse.json({ ok: true });
}
```

Note: `wahaUrl` uses `.url()` so a non-empty value must be a valid URL; to *clear* it send `null` (or omit). `wahaApiKey` empty string clears; omit to keep.

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

```bash
git add app/api/settings/notifications/route.ts
git commit -m "feat(api): GET/PATCH /api/settings/notifications (WAHA config)"
```

---

### Task 4: Notifications settings page — editable form

**Files:** Modify `app/dashboard/settings/notifications/page.tsx`; create `app/dashboard/settings/notifications/waha-form.tsx`

**Interfaces:** Consumes `resolveRole`, `wahaConfigStatus` (Task 1).

- [ ] **Step 1: Rewrite the page (server, admin) to load status + render the form**

```tsx
import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { wahaConfigStatus } from '@/lib/waha-config';
import WahaForm from './waha-form';
import TestButton from './test-button';

export default async function NotificationsSettingsPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const status = await wahaConfigStatus();

  return (
    <div className="max-w-xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <WahaForm initial={{
        url: status.url ?? '', urlSource: status.urlSource,
        apiKeyPreview: status.apiKeyPreview, apiKeySource: status.apiKeySource,
        session: status.session,
      }} />
      <div className="space-y-3 border border-border rounded-lg p-4 bg-surface text-sm">
        <p className="text-muted">If messages stop sending, the WAHA session may need a QR re-scan on the WAHA host.</p>
        <TestButton disabled={!status.configured} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the form (client)**

```tsx
'use client';
import { useState } from 'react';

type Source = 'db' | 'env' | 'none';
interface Initial { url: string; urlSource: Source; apiKeyPreview: string | null; apiKeySource: Source; session: string }

function hint(source: Source): string {
  return source === 'db' ? 'set here' : source === 'env' ? 'from env fallback' : 'not set';
}

export default function WahaForm({ initial }: { initial: Initial }) {
  const [url, setUrl] = useState(initial.url);
  const [session, setSession] = useState(initial.session);
  const [apiKey, setApiKey] = useState(''); // blank = keep existing
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setMsg(null);
    const body: Record<string, unknown> = {
      wahaUrl: url.trim() || null,
      wahaSession: session.trim() || null,
    };
    if (apiKey.trim()) body.wahaApiKey = apiKey.trim(); // omit to keep existing
    const res = await fetch('/api/settings/notifications', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved — takes effect immediately' : `Error (${res.status})`);
    if (res.ok) setApiKey('');
  };

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-surface">
      <label className="block text-sm">
        <span className="text-muted">WAHA URL <span className="text-xs">({hint(initial.urlSource)})</span></span>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://waha.example.com"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">API key <span className="text-xs">({hint(initial.apiKeySource)})</span></span>
        {initial.apiKeyPreview && <div className="mt-1 font-mono text-xs text-muted">current: {initial.apiKeyPreview}</div>}
        <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="leave blank to keep · paste to replace"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Session <span className="text-xs">({hint(initial.urlSource === 'none' ? 'none' : initial.urlSource)})</span></span>
        <input value={session} onChange={e => setSession(e.target.value)} placeholder="default"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <button disabled={busy} onClick={save} className="px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm text-muted">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS" && npm run build 2>&1 | grep -E "Compiled|error TS" | head -2`
Expected: `0`; build compiles.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/settings/notifications
git commit -m "feat(ui): editable WAHA connection form on Notifications settings"
```

---

### Task 5: Full verification + manual smoke

**Files:** none.

- [ ] **Step 1: Suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit 2>&1 | grep -c "error TS" && npm run build 2>&1 | grep -E "Compiled|error TS" | head -2`
Expected: all tests PASS; `0` type errors; build compiles.

- [ ] **Step 2: No stray direct WAHA env reads outside the resolver**

Run: `grep -rn "process.env.WAHA_\|wahaChannelFromEnv" lib app --include=*.ts --include=*.tsx | grep -v "lib/waha-config.ts"`
Expected: no matches (only `lib/waha-config.ts` reads the env vars now).

- [ ] **Step 3: Manual smoke (Docker DB + dev server)**

`npm run dev` → Settings → Notifications: the form shows current URL + a masked key preview with source hints. Change the URL, Save (no restart), Send test → delivered via the new URL. Blank the API-key box + Save → the key is kept (preview unchanged). Clear the URL → status falls back to env.

- [ ] **Step 4: Final commit if needed**

```bash
git add -A && git commit -m "test: WAHA settings verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:** §3 storage (reuse app_settings) → Task 1; §4 resolver (`resolveWaha`/`getWahaConfig`/`getWahaChannel`/`wahaConfigStatus`) → Task 1; §5 call-site refactor → Task 2; §6 GET/PATCH API + "blank keeps key" (`apiKeyPatchAction`/`applyWahaPatch`) → Tasks 1, 3; §7 form → Task 4; §8 security/testing → Tasks 1, 5. ✓

**Placeholder scan:** Full code for the resolver, API, and form; call-site refactors show exact before/after. No TBD.

**Type consistency:** `NotificationChannel` stays defined in `lib/notify.ts`, imported by `lib/waha-config.ts` (no cycle: notify no longer imports waha). `getWahaChannel(): Promise<NotificationChannel | null>` matches `buildNotifier`'s `channel` param. `wahaConfigStatus()` shape matches the form's `Initial`. `applyWahaPatch` body matches the PATCH zod schema (`wahaUrl`/`wahaApiKey`/`wahaSession`). Generic `getStringSetting`/`setStringSetting` added to settings.ts are the only new exports consumed by waha-config.
