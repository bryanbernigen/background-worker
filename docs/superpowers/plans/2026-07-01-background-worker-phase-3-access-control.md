# Background Worker — Phase 3: Access Control & PII Masking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin/guest access model — public read-only guest view (admin-togglable) with server-side PII masking, per-job guest visibility, write-route guards, and a guest "request full access" form that WhatsApps the admin.

**Architecture:** Roles resolve in the Node layer (RSC pages + API handlers) from an HMAC session token (`admin`) or, tokenless, a DB-backed guest-mode flag (`guest`). Edge middleware keeps a DB-free hard guard on mutating methods. Pure, DB-free modules (`lib/access/{role,mask,settings,paths}.ts`, `lib/contact.ts`) hold the logic; routes/pages are thin wrappers that call them and apply masking + a per-job visibility filter.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Drizzle ORM + PostgreSQL, Vitest, WAHA. Read `node_modules/next/dist/docs/` before touching Next-specific code per `AGENTS.md`.

**Spec:** `docs/superpowers/specs/2026-07-01-background-worker-phase-3-design.md`.

## Global Constraints

- Next.js is a modified build — read the relevant guide under `node_modules/next/dist/docs/` before writing Next code (`AGENTS.md`). Middleware runs on the **edge** (no DB); keep it crypto/string-only.
- Migrations: hand-author sql + `meta/<n>_snapshot.json` + journal entry, then validate with `npx drizzle-kit generate` → **"No schema changes, nothing to migrate"**. Apply with `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts` (`.env.local` LAST so its local Docker `DATABASE_URL` wins over `.env`'s remote one). Local DB: Docker `postgres:18-trixie` on `localhost:5432`.
- **Enforcement is server-side.** Guests must never receive raw PII/secrets in any API or RSC payload.
- TDD: failing test → watch fail → minimal impl → watch pass → commit. Run tests with `npx vitest run <path>` (`@/` resolves to repo root).
- End of phase: full suite + `tsc --noEmit` + `npm run build` green; admin flows behave exactly as today. DataAnnotation unchanged.
- Frequent commits: one per task minimum. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Schema + migration `0004_access_control`

Add the `app_settings` key-value table and `jobs.visibleToGuest`.

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0004_access_control.sql`, `lib/db/migrations/meta/0004_snapshot.json`
- Modify: `lib/db/migrations/meta/_journal.json`

**Interfaces:**
- Produces: `appSettings` table (`key: string` pk, `value: unknown` jsonb, `updatedAt`); `Job` gains `visibleToGuest: boolean`.

- [ ] **Step 1: Edit `lib/db/schema.ts`**

In the `jobs` table, after the `cronExpr` line add:

```ts
  visibleToGuest: boolean('visible_to_guest').notNull().default(true),
```

At the end of the file (after `runHistory`, before the `export type` block), add the table + its inferred types:

```ts
export const appSettings = pgTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

And add to the type exports at the bottom:

```ts
export type AppSetting = typeof appSettings.$inferSelect;
```

- [ ] **Step 2: Write the migration sql**

Create `lib/db/migrations/0004_access_control.sql`:

```sql
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "visible_to_guest" boolean DEFAULT true NOT NULL;
```

- [ ] **Step 3: Hand-author snapshot + journal**

Copy `meta/0003_snapshot.json` to `meta/0004_snapshot.json`. In the copy:
- `"id"` → fresh UUID (`node -e "console.log(require('crypto').randomUUID())"`).
- `"prevId"` → the `id` from `0003_snapshot.json` (`4d101edc-2cd1-40ed-a809-7bb9d07737c5`).
- In `tables."public.jobs".columns`, after `"cron_expr"`, add:

```json
        "visible_to_guest": {
          "name": "visible_to_guest",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": true
        },
```

- Add a new table entry inside `"tables"` (alongside `public.jobs` etc.):

```json
    "public.app_settings": {
      "name": "app_settings",
      "schema": "",
      "columns": {
        "key": { "name": "key", "type": "text", "primaryKey": true, "notNull": true },
        "value": { "name": "value", "type": "jsonb", "primaryKey": false, "notNull": true },
        "updated_at": { "name": "updated_at", "type": "timestamp with time zone", "primaryKey": false, "notNull": true, "default": "now()" }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {},
      "checkConstraints": {},
      "isRLSEnabled": false
    },
```

Append to `meta/_journal.json` `entries`:

```json
    {
      "idx": 4,
      "version": "7",
      "when": 1782912000000,
      "tag": "0004_access_control",
      "breakpoints": true
    }
```

- [ ] **Step 4: Validate snapshot matches schema**

Run: `npx drizzle-kit generate`
Expected: table summary shows `app_settings` + `jobs` with the new column, and **"No schema changes, nothing to migrate 😴"**. If it prompts or emits a `0005`, the snapshot is wrong — fix and re-run (delete any stray `0005*`).

- [ ] **Step 5: Apply + verify**

Run: `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts`
Expected: `migrations done`.

Verify with a throwaway `__verify.mjs` in the repo root:

```js
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const t = await c.query(`select to_regclass('public.app_settings') as t`);
const col = await c.query(`select column_default, is_nullable from information_schema.columns where table_name='jobs' and column_name='visible_to_guest'`);
console.log('app_settings exists:', t.rows[0].t); console.table(col.rows);
await c.end();
```

Run: `node --env-file=.env --env-file=.env.local __verify.mjs` then `rm __verify.mjs`
Expected: `app_settings exists: app_settings`; `visible_to_guest` default `true`, NOT NULL.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0004_access_control.sql lib/db/migrations/meta/0004_snapshot.json lib/db/migrations/meta/_journal.json
git commit -m "feat(db): app_settings table + jobs.visibleToGuest (migration 0004)"
```

---

### Task 2: Session roles in `lib/auth.ts`

Add `role` to the token; default legacy tokens to `admin`.

**Files:**
- Modify: `lib/auth.ts`
- Create: `lib/auth.test.ts`

**Interfaces:**
- Produces: `SessionPayload { username: string; role: 'admin' | 'guest'; exp: number }`; `createSessionToken(username: string, role?: 'admin' | 'guest'): Promise<string>` (default `'admin'`); `verifySessionToken(token): Promise<SessionPayload | null>` (missing role → `'admin'`).

- [ ] **Step 1: Write the failing test**

Create `lib/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createSessionToken, verifySessionToken } from './auth';

beforeAll(() => { process.env.JWT_SECRET = 'test-secret'; });

describe('session roles', () => {
  it('round-trips an admin token', async () => {
    const t = await createSessionToken('admin');
    const s = await verifySessionToken(t);
    expect(s?.username).toBe('admin');
    expect(s?.role).toBe('admin');
  });
  it('round-trips a guest token', async () => {
    const t = await createSessionToken('viewer', 'guest');
    expect((await verifySessionToken(t))?.role).toBe('guest');
  });
  it('rejects a tampered token', async () => {
    const t = await createSessionToken('admin');
    expect(await verifySessionToken(t + 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/auth.test.ts`
Expected: FAIL — `role` not on payload / `createSessionToken` arity.

- [ ] **Step 3: Edit `lib/auth.ts`**

Change the interface and the two functions:

```ts
export interface SessionPayload {
  username: string;
  role: 'admin' | 'guest';
  exp: number;
}
```

```ts
export async function createSessionToken(username: string, role: 'admin' | 'guest' = 'admin'): Promise<string> {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ username, role, exp });
  const payloadB64 = toBase64url(payload);
  const sig = await hmac(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}
```

In `verifySessionToken`, replace the payload parse + return:

```ts
    const { username, role, exp } = JSON.parse(fromBase64url(payloadB64));
    if (Date.now() > exp) return null;
    return { username, role: role === 'guest' ? 'guest' : 'admin', exp };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/auth.test.ts`
Expected: PASS (3 tests). (`app/api/auth/login/route.ts` calls `createSessionToken(username)` — still valid via the default `'admin'`; no change needed there.)

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts
git commit -m "feat(auth): session role (admin|guest), legacy tokens default to admin"
```

---

### Task 3: Access settings module

DB-backed `app_settings` accessors with a pure default-resolver.

**Files:**
- Create: `lib/access/settings.ts`, `lib/access/settings.test.ts`

**Interfaces:**
- Consumes: `appSettings` (Task 1).
- Produces: `guestModeFromValue(v: unknown): boolean`; `isGuestModeEnabled(): Promise<boolean>`; `setGuestMode(on: boolean): Promise<void>`; `getAdminContactPhone(): Promise<string | null>`; `setAdminContactPhone(phone: string | null): Promise<void>`.

- [ ] **Step 1: Write the failing test (pure resolver)**

Create `lib/access/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { guestModeFromValue } from './settings';

describe('guestModeFromValue', () => {
  it('defaults to true when unset', () => {
    expect(guestModeFromValue(undefined)).toBe(true);
    expect(guestModeFromValue(null)).toBe(true);
  });
  it('honors an explicit boolean', () => {
    expect(guestModeFromValue(false)).toBe(false);
    expect(guestModeFromValue(true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/access/settings.test.ts`
Expected: FAIL — `./settings` does not exist.

- [ ] **Step 3: Implement `lib/access/settings.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { appSettings } from '@/lib/db/schema';

async function getSetting(key: string): Promise<unknown> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Guest mode defaults to ON when the setting has never been written. */
export function guestModeFromValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  return v === true;
}

export async function isGuestModeEnabled(): Promise<boolean> {
  return guestModeFromValue(await getSetting('guest_mode'));
}
export async function setGuestMode(on: boolean): Promise<void> {
  await setSetting('guest_mode', on);
}
export async function getAdminContactPhone(): Promise<string | null> {
  const v = await getSetting('admin_contact_phone');
  return typeof v === 'string' && v.length > 0 ? v : null;
}
export async function setAdminContactPhone(phone: string | null): Promise<void> {
  await setSetting('admin_contact_phone', phone);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/access/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access/settings.ts lib/access/settings.test.ts
git commit -m "feat(access): app_settings accessors (guest mode, admin contact phone)"
```

---

### Task 4: Role resolution + guards

**Files:**
- Create: `lib/access/role.ts`, `lib/access/role.test.ts`

**Interfaces:**
- Consumes: `verifySessionToken`/`SessionPayload` (Task 2), `isGuestModeEnabled` (Task 3).
- Produces:
  - `type Role = 'admin' | 'guest'`
  - `roleFromToken(session: SessionPayload | null, guestModeEnabled: boolean): Role | null` (pure)
  - `resolveRole(): Promise<Role | null>`
  - `requireAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }>`
  - `requireViewer(): Promise<{ ok: true; role: Role } | { ok: false; res: NextResponse }>`

- [ ] **Step 1: Write the failing test (pure resolver)**

Create `lib/access/role.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roleFromToken } from './role';

const admin = { username: 'a', role: 'admin' as const, exp: Date.now() + 1e6 };

describe('roleFromToken', () => {
  it('valid admin token -> admin', () => {
    expect(roleFromToken(admin, false)).toBe('admin');
    expect(roleFromToken(admin, true)).toBe('admin');
  });
  it('no token + guest mode on -> guest', () => {
    expect(roleFromToken(null, true)).toBe('guest');
  });
  it('no token + guest mode off -> null', () => {
    expect(roleFromToken(null, false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/access/role.test.ts`
Expected: FAIL — `./role` does not exist.

- [ ] **Step 3: Implement `lib/access/role.ts`**

```ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken, type SessionPayload } from '@/lib/auth';
import { isGuestModeEnabled } from './settings';

export type Role = 'admin' | 'guest';

/** Pure role decision. A valid token means admin (only admins get tokens);
 *  otherwise guest when guest-mode is on, else no access. */
export function roleFromToken(session: SessionPayload | null, guestModeEnabled: boolean): Role | null {
  if (session) return session.role;
  return guestModeEnabled ? 'guest' : null;
}

export async function resolveRole(): Promise<Role | null> {
  const store = await cookies();
  const token = store.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  return roleFromToken(session, await isGuestModeEnabled());
}

export async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const role = await resolveRole();
  if (role === 'admin') return { ok: true };
  return { ok: false, res: NextResponse.json({ error: role ? 'forbidden' : 'unauthorized' }, { status: role ? 403 : 401 }) };
}

export async function requireViewer(): Promise<{ ok: true; role: Role } | { ok: false; res: NextResponse }> {
  const role = await resolveRole();
  if (!role) return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  return { ok: true, role };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/access/role.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access/role.ts lib/access/role.test.ts
git commit -m "feat(access): resolveRole + requireAdmin/requireViewer guards"
```

---

### Task 5: Server-side masking

**Files:**
- Create: `lib/access/mask.ts`, `lib/access/mask.test.ts`

**Interfaces:**
- Consumes: `Role` (Task 4).
- Produces:
  - `maskName(name: string): string`
  - `maskPhone(phone: string): string`
  - `maskRecipient<T extends { name: string; phone: string }>(role: Role, r: T): T`
  - `maskRunDetail<T extends Record<string, unknown>>(role: Role, row: T): Partial<T>`
  - `maskJobCustom(role: Role, custom: unknown): unknown` (guest → `undefined`)

- [ ] **Step 1: Write the failing test**

Create `lib/access/mask.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { maskName, maskPhone, maskRecipient, maskRunDetail, maskJobCustom } from './mask';

describe('maskName', () => {
  it('keeps first and last char', () => {
    expect(maskName('Bryan')).toBe('B***n');
  });
  it('masks fully for <=2 chars', () => {
    expect(maskName('Al')).toBe('**');
    expect(maskName('A')).toBe('*');
    expect(maskName('')).toBe('*');
  });
});

describe('maskPhone', () => {
  it('keeps the last 4 digits', () => {
    expect(maskPhone('+62 812-3456-7890')).toBe('••••7890');
  });
  it('masks fully when <=4 digits', () => {
    expect(maskPhone('123')).toBe('***');
  });
});

describe('maskRecipient', () => {
  const r = { id: 1, name: 'Bryan', phone: '628123456789', tag: 'new-task' };
  it('admin -> unchanged', () => { expect(maskRecipient('admin', r)).toEqual(r); });
  it('guest -> name+phone masked', () => {
    const m = maskRecipient('guest', r);
    expect(m.name).toBe('B***n');
    expect(m.phone).toBe('••••6789');
    expect(m.tag).toBe('new-task');
  });
});

describe('maskRunDetail', () => {
  const row = { id: 1, status: 'ok', summary: 's', data: { x: 1 }, rawHtml: '<x>', errorMessage: 'e' };
  it('admin -> unchanged', () => { expect(maskRunDetail('admin', row)).toEqual(row); });
  it('guest -> drops data/rawHtml/errorMessage', () => {
    const m = maskRunDetail('guest', row) as Record<string, unknown>;
    expect(m.summary).toBe('s');
    expect('data' in m).toBe(false);
    expect('rawHtml' in m).toBe(false);
    expect('errorMessage' in m).toBe(false);
  });
});

describe('maskJobCustom', () => {
  it('admin keeps, guest omits', () => {
    expect(maskJobCustom('admin', { a: 1 })).toEqual({ a: 1 });
    expect(maskJobCustom('guest', { a: 1 })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/access/mask.test.ts`
Expected: FAIL — `./mask` does not exist.

- [ ] **Step 3: Implement `lib/access/mask.ts`**

```ts
import type { Role } from './role';

export function maskName(name: string): string {
  const n = name.trim();
  if (n.length <= 2) return '*'.repeat(Math.max(n.length, 1));
  return `${n[0]}${'*'.repeat(n.length - 2)}${n[n.length - 1]}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(Math.max(digits.length, 1));
  return `••••${digits.slice(-4)}`;
}

export function maskRecipient<T extends { name: string; phone: string }>(role: Role, r: T): T {
  if (role === 'admin') return r;
  return { ...r, name: maskName(r.name), phone: maskPhone(r.phone) };
}

export function maskRunDetail<T extends Record<string, unknown>>(role: Role, row: T): Partial<T> {
  if (role === 'admin') return row;
  const rest = { ...row };
  delete (rest as Record<string, unknown>).data;
  delete (rest as Record<string, unknown>).rawHtml;
  delete (rest as Record<string, unknown>).errorMessage;
  return rest;
}

export function maskJobCustom(role: Role, custom: unknown): unknown {
  return role === 'admin' ? custom : undefined;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/access/mask.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access/mask.ts lib/access/mask.test.ts
git commit -m "feat(access): server-side PII masking helpers"
```

---

### Task 6: Path helper + middleware write-guard

**Files:**
- Create: `lib/access/paths.ts`, `lib/access/paths.test.ts`
- Modify: `middleware.ts`

**Interfaces:**
- Produces: `requiresAdminToken(pathname: string, method: string): boolean` (pure).

- [ ] **Step 1: Write the failing test**

Create `lib/access/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { requiresAdminToken } from './paths';

describe('requiresAdminToken', () => {
  it('guards mutating /api routes', () => {
    expect(requiresAdminToken('/api/jobs', 'POST')).toBe(true);
    expect(requiresAdminToken('/api/jobs/x/settings', 'PATCH')).toBe(true);
    expect(requiresAdminToken('/api/jobs/x', 'DELETE')).toBe(true);
  });
  it('allows GET /api routes (handlers gate reads)', () => {
    expect(requiresAdminToken('/api/jobs/x/history', 'GET')).toBe(false);
  });
  it('exempts public + specially-gated routes', () => {
    expect(requiresAdminToken('/api/auth/login', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/auth/logout', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/contact', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/cron/check', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/health', 'POST')).toBe(false);
  });
  it('does not guard page routes', () => {
    expect(requiresAdminToken('/dashboard', 'GET')).toBe(false);
    expect(requiresAdminToken('/dashboard/jobs/x', 'POST')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/access/paths.test.ts`
Expected: FAIL — `./paths` does not exist.

- [ ] **Step 3: Implement `lib/access/paths.ts`**

```ts
const PUBLIC = new Set(['/api/auth/login', '/api/auth/logout', '/api/contact']);
const SPECIAL = new Set(['/api/health', '/api/cron/check', '/api/cron/tick']); // gated elsewhere in middleware
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True when middleware should require a valid admin token before allowing. */
export function requiresAdminToken(pathname: string, method: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (PUBLIC.has(pathname) || SPECIAL.has(pathname)) return false;
  return MUTATING.has(method);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/access/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite middleware section 3 + add `/api/contact` to pass-through**

In `middleware.ts`, add the import:

```ts
import { requiresAdminToken } from '@/lib/access/paths';
```

Add `/api/contact` to the section-1 public list:

```ts
  if (pathname === '/' || pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/contact') {
    return NextResponse.next();
  }
```

Replace section 3 (the `// 3. Secure all other paths` block through the end of the function body, i.e. the current `const token = ...; const session = ...; if (!session) { ... } return NextResponse.next();`) with:

```ts
  // 3. Writes require an admin token at the edge (DB-free). GET/pages pass
  //    through; the Node layer resolves admin/guest and applies masking,
  //    visibility, and per-page redirects.
  const token = req.cookies.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  const isAdmin = session?.role === 'admin';

  if (requiresAdminToken(pathname, req.method) && !isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.next();
```

- [ ] **Step 6: Verify typecheck + tests**

Run: `npx vitest run lib/access/paths.test.ts && npx tsc --noEmit 2>&1 | grep -i middleware || echo clean`
Expected: tests PASS; `clean`.

- [ ] **Step 7: Commit**

```bash
git add lib/access/paths.ts lib/access/paths.test.ts middleware.ts
git commit -m "feat(access): edge write-guard via requiresAdminToken; guests pass GET/pages"
```

---

### Task 7: Admin-guard the mutating routes

Swap `requireSession` → `requireAdmin` on every write route (defense in depth behind the middleware).

**Files:**
- Modify: `app/api/jobs/route.ts` (POST), `app/api/jobs/[slug]/route.ts` (DELETE), `app/api/jobs/[slug]/settings/route.ts` (PATCH), `app/api/jobs/[slug]/run/route.ts` (POST), `app/api/jobs/[slug]/recipients/route.ts` (POST), `app/api/jobs/[slug]/recipients/[id]/route.ts` (PUT, DELETE), `app/api/jobs/[slug]/recipients/[id]/test/route.ts` (POST)

**Interfaces:**
- Consumes: `requireAdmin` (Task 4).

- [ ] **Step 1: Replace the guard in each mutating handler**

In each file above, for the mutating handler(s), replace:

```ts
import { requireSession } from '@/lib/api/require-session';
```
with
```ts
import { requireAdmin } from '@/lib/access/role';
```

and replace the guard line inside each mutating handler:

```ts
  const guard = await requireSession(); if (!guard.ok) return guard.res;
```
with
```ts
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
```

Notes:
- `app/api/jobs/[slug]/route.ts` also has a **GET** (handled in Task 8) — leave its guard for now; keep both imports if needed until Task 8. After Task 8 the file uses `requireViewer` for GET and `requireAdmin` for DELETE.
- `app/api/jobs/[slug]/recipients/route.ts` also has a **GET** (Task 8) — same note.
- `app/api/jobs/[slug]/settings/route.ts` only has PATCH → fully switches to `requireAdmin`.
- The `[id]` recipients file has PUT + DELETE → both switch.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "api/jobs" || echo clean`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add app/api/jobs
git commit -m "feat(api): mutating routes require admin role"
```

---

### Task 8: Read routes become role-aware (viewer + mask + visibility)

**Files:**
- Modify: `app/api/jobs/[slug]/route.ts` (GET), `app/api/jobs/[slug]/recipients/route.ts` (GET), `app/api/jobs/[slug]/history/route.ts` (GET)

**Interfaces:**
- Consumes: `requireViewer`, `Role` (Task 4); `maskRecipient`, `maskRunDetail`, `maskJobCustom` (Task 5); `jobs.visibleToGuest` (Task 1).

- [ ] **Step 1: Job GET — viewer + visibility + omit custom for guests**

In `app/api/jobs/[slug]/route.ts` GET handler: import `requireViewer` and `maskJobCustom`, replace the guard, and gate visibility + custom. Replace the guard line with:

```ts
  const guard = await requireViewer(); if (!guard.ok) return guard.res;
  const { role } = guard;
```

After the `if (!job) …404` line, add:

```ts
  if (role === 'guest' && !job.visibleToGuest) return NextResponse.json({ error: 'job not found' }, { status: 404 });
```

Wrap the returned `custom` field so guests get nothing:

```ts
      custom: maskJobCustom(role, customOut),
```

Add imports:
```ts
import { requireViewer } from '@/lib/access/role';
import { maskJobCustom } from '@/lib/access/mask';
```
(Remove the now-unused `requireSession` import from the GET path; keep `requireAdmin` for DELETE.)

- [ ] **Step 2: Recipients GET — viewer + visibility + mask each row**

In `app/api/jobs/[slug]/recipients/route.ts` GET: import `requireViewer` + `maskRecipient`; replace the guard with `requireViewer`; after loading the job add the guest visibility 404; map results through the mask:

```ts
  const guard = await requireViewer(); if (!guard.ok) return guard.res;
  const { role } = guard;
```
```ts
  if (role === 'guest' && !job.visibleToGuest) return NextResponse.json({ error: 'job not found' }, { status: 404 });
```
```ts
  const rows = await db.select().from(recipients).where(where);
  return NextResponse.json({ recipients: rows.map(r => maskRecipient(role, r)) });
```

Add imports:
```ts
import { requireViewer } from '@/lib/access/role';
import { maskRecipient } from '@/lib/access/mask';
```
(POST already uses `requireAdmin` from Task 7.)

- [ ] **Step 3: History GET — viewer + visibility + mask detail**

In `app/api/jobs/[slug]/history/route.ts`: import `requireViewer` + `maskRunDetail`; replace the guard with `requireViewer` capturing `role`; after `if (!job) …404` add the guest visibility 404; and in the `detailId` branch mask the row:

```ts
  const guard = await requireViewer(); if (!guard.ok) return guard.res;
  const { role } = guard;
```
```ts
  if (role === 'guest' && !job.visibleToGuest) return NextResponse.json({ error: 'job not found' }, { status: 404 });
```
In the detail branch, replace `return NextResponse.json({ detail: row });` with:
```ts
    return NextResponse.json({ detail: maskRunDetail(role, row) });
```
(The list projection already contains only safe fields — `summary`, status, timing — so it needs no masking.)

Add imports:
```ts
import { requireViewer } from '@/lib/access/role';
import { maskRunDetail } from '@/lib/access/mask';
```

- [ ] **Step 4: Remove `require-session.ts` if now unused**

Run: `grep -rn "require-session" app lib --include=*.ts | grep -v node_modules || echo "unused"`
If `unused`: `git rm lib/api/require-session.ts`. Otherwise leave it and switch the remaining importers to `requireAdmin`/`requireViewer` as appropriate.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "api/jobs|require-session" || echo clean`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add app/api/jobs lib/api 2>/dev/null; git commit -m "feat(api): read routes resolve viewer role, mask PII, enforce guest visibility"
```

---

### Task 9: Contact core (`lib/contact.ts`)

Pure validation, rate-limit, and message formatting for the guest contact form.

**Files:**
- Create: `lib/contact.ts`, `lib/contact.test.ts`

**Interfaces:**
- Produces:
  - `interface ContactInput { name: string; contact: string; message: string }`
  - `class ContactError extends Error { status: number }`
  - `type ValidateResult = { kind: 'ok'; input: ContactInput } | { kind: 'honeypot' }`
  - `validateContact(body: unknown): ValidateResult` (throws `ContactError(400)` on invalid)
  - `checkRateLimit(ip: string, now?: number): boolean` (3 per rolling hour)
  - `formatContactMessage(i: ContactInput): string`

- [ ] **Step 1: Write the failing test**

Create `lib/contact.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateContact, checkRateLimit, formatContactMessage, ContactError } from './contact';

describe('validateContact', () => {
  const good = { name: 'Ann', contact: 'ann@x.com', message: 'hi there' };
  it('accepts good input', () => {
    expect(validateContact(good)).toEqual({ kind: 'ok', input: good });
  });
  it('trims and rejects empties', () => {
    expect(() => validateContact({ ...good, name: '   ' })).toThrow(ContactError);
    expect(() => validateContact({ ...good, message: '' })).toThrow(ContactError);
  });
  it('rejects over-long fields', () => {
    expect(() => validateContact({ ...good, message: 'x'.repeat(1001) })).toThrow(ContactError);
  });
  it('treats a filled honeypot as honeypot (no throw)', () => {
    expect(validateContact({ ...good, company: 'spam' })).toEqual({ kind: 'honeypot' });
  });
});

describe('checkRateLimit', () => {
  it('allows 3 then blocks the 4th within the window', () => {
    const ip = 'test-ip-a'; const t = 1_000_000;
    expect(checkRateLimit(ip, t)).toBe(true);
    expect(checkRateLimit(ip, t + 1)).toBe(true);
    expect(checkRateLimit(ip, t + 2)).toBe(true);
    expect(checkRateLimit(ip, t + 3)).toBe(false);
  });
  it('frees up after the window passes', () => {
    const ip = 'test-ip-b'; const t = 5_000_000;
    checkRateLimit(ip, t); checkRateLimit(ip, t); checkRateLimit(ip, t);
    expect(checkRateLimit(ip, t + 3_600_001)).toBe(true);
  });
});

describe('formatContactMessage', () => {
  it('includes all fields', () => {
    const msg = formatContactMessage({ name: 'Ann', contact: 'a@x.com', message: 'hello' });
    expect(msg).toContain('Ann'); expect(msg).toContain('a@x.com'); expect(msg).toContain('hello');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/contact.test.ts`
Expected: FAIL — `./contact` does not exist.

- [ ] **Step 3: Implement `lib/contact.ts`**

```ts
import { z } from 'zod';

export interface ContactInput { name: string; contact: string; message: string }

export class ContactError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; this.name = 'ContactError'; }
}

export type ValidateResult = { kind: 'ok'; input: ContactInput } | { kind: 'honeypot' };

const schema = z.object({
  name:    z.string().trim().min(1).max(80),
  contact: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
  company: z.string().optional(), // honeypot — real users never fill it
});

export function validateContact(body: unknown): ValidateResult {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ContactError(parsed.error.issues.map(i => i.message).join('; '));
  if (parsed.data.company && parsed.data.company.trim().length > 0) return { kind: 'honeypot' };
  const { name, contact, message } = parsed.data;
  return { kind: 'ok', input: { name, contact, message } };
}

const WINDOW_MS = 3_600_000;
const LIMIT = 3;
const hits = new Map<string, number[]>();

/** Per-IP sliding-window limiter (in-process, matches the single-instance model). */
export function checkRateLimit(ip: string, now: number = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) { hits.set(ip, recent); return false; }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export function formatContactMessage(i: ContactInput): string {
  return `📨 *New access request*\n\n*Name:* ${i.name}\n*Contact:* ${i.contact}\n\n${i.message}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/contact.ts lib/contact.test.ts
git commit -m "feat(contact): validation, per-IP rate limit, message formatting"
```

---

### Task 10: Contact route + access settings route

**Files:**
- Create: `app/api/contact/route.ts`, `app/api/settings/access/route.ts`

**Interfaces:**
- Consumes: `validateContact`/`checkRateLimit`/`formatContactMessage`/`ContactError` (Task 9); `getAdminContactPhone`/`isGuestModeEnabled`/`setGuestMode`/`setAdminContactPhone` (Task 3); `wahaChannelFromEnv` (`@/lib/notify`); `requireAdmin` (Task 4).

- [ ] **Step 1: Implement `app/api/contact/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { validateContact, checkRateLimit, formatContactMessage, ContactError } from '@/lib/contact';
import { getAdminContactPhone } from '@/lib/access/settings';
import { wahaChannelFromEnv } from '@/lib/notify';

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(ip)) return NextResponse.json({ error: 'Too many requests — try again later.' }, { status: 429 });

  let parsed;
  try { parsed = validateContact(await req.json().catch(() => null)); }
  catch (e) {
    if (e instanceof ContactError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (parsed.kind === 'honeypot') return NextResponse.json({ ok: true }); // silently drop bots

  const phone = await getAdminContactPhone();
  const channel = wahaChannelFromEnv();
  if (!phone || !channel) return NextResponse.json({ error: 'Contact is unavailable right now.' }, { status: 503 });

  let sent = false;
  try { sent = await channel.sendText(phone, formatContactMessage(parsed.input)); }
  catch (e) { console.error('[contact] send failed', e); }
  if (!sent) return NextResponse.json({ error: 'Delivery failed — please try another channel.' }, { status: 502 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement `app/api/settings/access/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/access/role';
import { isGuestModeEnabled, setGuestMode, getAdminContactPhone, setAdminContactPhone } from '@/lib/access/settings';

export async function GET() {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  return NextResponse.json({ guestMode: await isGuestModeEnabled(), adminContactPhone: await getAdminContactPhone() });
}

const patch = z.object({
  guestMode:        z.boolean().optional(),
  adminContactPhone: z.string().min(5).nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const parsed = patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  if (parsed.data.guestMode !== undefined) await setGuestMode(parsed.data.guestMode);
  if (parsed.data.adminContactPhone !== undefined) await setAdminContactPhone(parsed.data.adminContactPhone);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "api/contact|settings/access" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add app/api/contact app/api/settings
git commit -m "feat(api): public POST /api/contact + admin GET/PATCH /api/settings/access"
```

---

### Task 11: UI wiring — role-aware pages + contact form

Make the current pages present safely to guests: filter hidden jobs, hide admin controls, render masked data, and show the "Request full access" form.

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/dashboard/jobs/[slug]/page.tsx`
- Modify: `app/dashboard/jobs/[slug]/recipients-panel.tsx`
- Create: `app/dashboard/contact-admin.tsx`

**Interfaces:**
- Consumes: `resolveRole` (Task 4), `getAdminContactPhone` (Task 3), `jobs.visibleToGuest` (Task 1).

- [ ] **Step 1: Contact form component**

Create `app/dashboard/contact-admin.tsx`:

```tsx
'use client';
import { useState } from 'react';

export default function ContactAdmin() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [contact, setContact] = useState(''); const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true); setMsg(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, contact, message, company }),
      });
      if (res.ok) { setMsg('Sent — the admin will get back to you.'); setName(''); setContact(''); setMessage(''); }
      else { const b = await res.json().catch(() => ({})); setMsg(b.error ?? `Failed (${res.status})`); }
    } finally { setSending(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">
        Request full access
      </button>
    );
  }
  return (
    <div className="border rounded-lg bg-white shadow-sm p-4 w-full max-w-md space-y-2">
      <h3 className="font-semibold">Request full access</h3>
      <input className="border rounded px-2 py-1 text-sm w-full" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
      <input className="border rounded px-2 py-1 text-sm w-full" placeholder="How to reach you (email / WhatsApp)" value={contact} onChange={e => setContact(e.target.value)} />
      <textarea className="border rounded px-2 py-1 text-sm w-full" placeholder="Message" rows={3} value={message} onChange={e => setMessage(e.target.value)} />
      <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={company} onChange={e => setCompany(e.target.value)} />
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={sending || !name || !contact || !message}
          className="text-sm px-3 py-1.5 rounded bg-green-600 text-white disabled:bg-gray-300">
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button onClick={() => setOpen(false)} className="text-sm px-3 py-1.5 rounded border">Cancel</button>
      </div>
      {msg && <div className="text-sm text-gray-600">{msg}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Dashboard — role + visibility + contact button**

In `app/dashboard/page.tsx`, replace the auth/query block. Replace:

```ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
```
with
```ts
import { redirect } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import ContactAdmin from './contact-admin';
```

Replace the token check + jobs query:

```ts
  const token = (await cookies()).get('session')?.value;
  if (!token || !(await verifySessionToken(token))) redirect('/');

  const rows = await db.select().from(jobs);
```
with
```ts
  const role = await resolveRole();
  if (!role) redirect('/');
  const isAdmin = role === 'admin';

  const rows = isAdmin
    ? await db.select().from(jobs)
    : await db.select().from(jobs).where(eq(jobs.visibleToGuest, true));
  const contactEnabled = !isAdmin && !!(await getAdminContactPhone()) && !!process.env.WAHA_URL;
```

Replace the header's logout form region so guests get the contact button instead:

```tsx
          {isAdmin ? (
            <form action="/api/auth/logout" method="POST">
              <button className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
            </form>
          ) : contactEnabled ? (
            <ContactAdmin />
          ) : null}
```

(`eq` and `jobs` are already imported in this file.)

- [ ] **Step 3: Job page — role gating + hidden-job 404 + masked read-only**

In `app/dashboard/jobs/[slug]/page.tsx`, replace the auth block:

```ts
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
```
with
```ts
import { notFound, redirect } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
```

Replace:

```ts
  const token = (await cookies()).get('session')?.value;
  if (!token || !(await verifySessionToken(token))) redirect('/');

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return notFound();
  const mod = getJob(job.type);
```
with
```ts
  const role = await resolveRole();
  if (!role) redirect('/');
  const isAdmin = role === 'admin';

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return notFound();
  if (!isAdmin && !job.visibleToGuest) return notFound();
  const mod = getJob(job.type);
```

Gate the admin-only controls. Replace the actions/schedule/settings block:

```tsx
        <div className="flex items-center gap-4">
          <Countdown slug={slug} initial={{
            nextRunAt: job.nextRunAt?.toISOString() ?? null,
            lastRunAt: job.lastRunAt?.toISOString() ?? null,
            minIntervalS: job.minIntervalS,
            maxIntervalS: job.maxIntervalS,
            enabled: job.enabled,
          }} />
          <div className="shrink-0 flex items-start gap-2">
            <RunNowButton slug={slug} />
            <EnableToggle slug={slug} initialEnabled={job.enabled} />
          </div>
        </div>

        <ScheduleForm slug={slug} initial={{
          minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
          dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
        }} />
        {Panel && <Panel jobId={job.id} current={customForPanel} />}
        <RecipientsPanel slug={slug} tag="new-task" title="WhatsApp recipients (new-task alerts)" />
        <RecipientsPanel slug={slug} tag="cookie-expiry" title="Cookie-expiry alert recipients" />
```

with an admin/guest split:

```tsx
        <div className="flex items-center gap-4">
          <Countdown slug={slug} initial={{
            nextRunAt: job.nextRunAt?.toISOString() ?? null,
            lastRunAt: job.lastRunAt?.toISOString() ?? null,
            minIntervalS: job.minIntervalS,
            maxIntervalS: job.maxIntervalS,
            enabled: job.enabled,
          }} />
          {isAdmin && (
            <div className="shrink-0 flex items-start gap-2">
              <RunNowButton slug={slug} />
              <EnableToggle slug={slug} initialEnabled={job.enabled} />
            </div>
          )}
        </div>

        {isAdmin && (
          <ScheduleForm slug={slug} initial={{
            minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
            dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
          }} />
        )}
        {isAdmin && Panel && <Panel jobId={job.id} current={customForPanel} />}
        <RecipientsPanel slug={slug} tag="new-task" title="WhatsApp recipients (new-task alerts)" admin={isAdmin} />
        <RecipientsPanel slug={slug} tag="cookie-expiry" title="Cookie-expiry alert recipients" admin={isAdmin} />
```

Make the header read-only for guests. Replace:

```tsx
        <EditableHeader slug={slug} initial={{
          title: job.title, url: job.url, description: job.description,
        }} />
```
with
```tsx
        {isAdmin ? (
          <EditableHeader slug={slug} initial={{
            title: job.title, url: job.url, description: job.description,
          }} />
        ) : (
          <div>
            <h1 className="text-2xl font-bold">{job.title}</h1>
            <p className="text-sm text-gray-500">{job.description}</p>
          </div>
        )}
```

(The `customForPanel` decrypt/preview loop only feeds the admin-gated `Panel`; leaving it computed is harmless, but it may be skipped for guests. Leave as-is for simplicity.)

- [ ] **Step 4: RecipientsPanel — `admin` prop gates controls**

In `app/dashboard/jobs/[slug]/recipients-panel.tsx`, add `admin` to `Props` and default it, and hide the mutating controls for guests. Update the interface + signature:

```tsx
interface Props {
  slug: string;
  tag?: 'new-task' | 'cookie-expiry';
  title?: string;
  admin?: boolean;
}

export default function RecipientsPanel({ slug, tag = 'new-task', title = 'WhatsApp recipients', admin = true }: Props) {
```

Wrap the per-row action buttons (Save / Test / Delete) so they only render for admins — replace the three `<button>`s in the row with:

```tsx
              {admin && (
                <>
                  <button
                    onClick={() => update(r)}
                    disabled={!dirty[r.id]}
                    className="text-xs px-2 py-1 rounded border bg-blue-600 text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >Save</button>
                  <button onClick={() => test(r.id)}
                    className="text-xs px-2 py-1 rounded border hover:bg-gray-50">Test</button>
                  <button onClick={() => del(r.id)}
                    className="text-xs px-2 py-1 rounded border text-red-700 hover:bg-red-50">Delete</button>
                </>
              )}
```

Make the name/phone inputs read-only for guests by adding `readOnly={!admin}` to both row `<input>` elements. Hide the "add recipient" footer for guests — wrap the entire add-row `<div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t bg-gray-50">…</div>` in `{admin && ( … )}`.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard
git commit -m "feat(ui): role-aware dashboard + job page; guest contact form"
```

---

### Task 12: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: all suites PASS (Phase 1/2 + new: auth, access/settings, access/role, access/mask, access/paths, contact).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; build succeeds.

- [ ] **Step 3: Manual smoke (needs Docker DB + dev server)**

`npm run dev`, then:
- **Guest (logged out):** open `/dashboard` in a private window → see only `visibleToGuest` jobs, no admin buttons; open a job → recipients show masked name+phone, no Save/Test/Delete/Add, no schedule/cookie forms; run-history detail shows no `data`/raw fields. The **Request full access** button appears (if `admin_contact_phone` + WAHA set) and submitting WhatsApps you.
- **Admin (logged in):** everything works as before (create/run/edit/delete, unmasked data).
- **Toggle:** `PATCH /api/settings/access {"guestMode": false}` (as admin) → logged-out `/dashboard` now redirects to `/`. Set an `adminContactPhone` via the same route.
- **Write guard:** `curl -X POST localhost:3000/api/jobs -d '{}'` with no cookie → `403`.

- [ ] **Step 4: Final commit (if fixes needed)**

```bash
git add -A && git commit -m "test: Phase 3 verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §2/§3 roles + resolution → Tasks 2, 4 ✓
- §4 `app_settings` + guest-mode + admin-contact accessors + access route → Tasks 1, 3, 10 ✓
- §5 `jobs.visibleToGuest` + server-side visibility filtering → Tasks 1, 8, 11 ✓
- §6 masking (`maskName`/`maskPhone`/`maskRecipient`/`maskRunDetail`/`maskJobCustom`) → Task 5, applied in Tasks 8, 11 ✓
- §7 write protection: middleware edge guard + handler `requireAdmin` → Tasks 6, 7 ✓ (auth/contact exemptions in Task 6)
- §7.5 contact form (validate/rate-limit/honeypot/format, `POST /api/contact`, UI button) → Tasks 9, 10, 11 ✓
- §8 current-UI wiring (mask, hide controls, visibility, read-only header) → Task 11 ✓
- §9 testing → per-task tests + Task 12 ✓
- Out of scope (correctly absent): Split Console redesign (Phase 4), rename/cleanup (Phase 5).

**Placeholder scan:** No TBD/TODO; every code step is complete; migration validated by the drizzle-kit "No schema changes" check; the only grep-driven step (Task 8 Step 4) has explicit follow-ups.

**Type consistency:** `Role` (Task 4) is consumed by `mask.ts` (Task 5), the read routes (Task 8), and pages (Task 11). `requireAdmin`/`requireViewer` return `{ ok: true … } | { ok: false; res }` used identically across Tasks 7, 8, 10. `resolveRole(): Role | null`, `guestModeFromValue`, `roleFromToken`, `requiresAdminToken`, `validateContact`/`checkRateLimit`/`formatContactMessage`, `maskRecipient`/`maskRunDetail`/`maskJobCustom`, `getAdminContactPhone`/`isGuestModeEnabled` names match between defining and consuming tasks. `SessionPayload.role` (Task 2) feeds `roleFromToken`/middleware (Tasks 4, 6).
