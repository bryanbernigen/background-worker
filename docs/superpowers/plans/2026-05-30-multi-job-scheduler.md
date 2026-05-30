# Multi-Job Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the auto-checker app from an Upstash-Redis + external-cron architecture to a Northflank-Postgres + in-process-scheduler architecture, structured around a job-module contract so each scraper has its own self-contained code.

**Architecture:** One Next.js 16 container talking to managed Postgres. A singleton scheduler (loaded via `instrumentation.ts`) holds one `setTimeout` per job, persisting `next_run_at` between firings; Postgres advisory locks serialize concurrent runs. Each job is a `JobModule` exporting metadata + a `runCheck` function + an optional custom settings panel.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Postgres, Drizzle ORM (`drizzle-orm` + `drizzle-kit`), `pg`, `zod`, `bcryptjs`, `aes-256-gcm` (Node `crypto`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-30-multi-job-scheduler-design.md`

**Pre-existing reality (verified, must be addressed):**
- `app/api/auth/login/route.ts:11` compares passwords as plaintext (`!==`). Task 4 fixes this.
- Next.js 16 instrumentation API: `export function register()`, runtime-gated on `process.env.NEXT_RUNTIME === 'nodejs'`.

---

## Phase 1 — Foundation

### Task 1: Add dependencies and configure Drizzle

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`
- Create: `lib/db/client.ts`

- [ ] **Step 1: Update package.json dependencies**

In `package.json`, modify `dependencies` and `devDependencies`:
```jsonc
"dependencies": {
  "bcryptjs": "^2.4.3",
  "drizzle-orm": "^0.36.0",
  "next": "16.2.6",
  "pg": "^8.13.0",
  "react": "19.2.4",
  "react-dom": "19.2.4",
  "zod": "^3.23.0"
},
"devDependencies": {
  "@tailwindcss/postcss": "^4",
  "@types/bcryptjs": "^2.4.6",
  "@types/node": "^20",
  "@types/pg": "^8.11.0",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "@vitejs/plugin-react": "^6.0.2",
  "drizzle-kit": "^0.28.0",
  "eslint": "^9",
  "eslint-config-next": "16.2.6",
  "tailwindcss": "^4",
  "typescript": "^5",
  "vitest": "^4.1.6"
}
```
Delete `"@upstash/redis"` from dependencies.

- [ ] **Step 2: Run install**

Run: `npm install`
Expected: completes without error, lockfile updated.

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

- [ ] **Step 4: Create `lib/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
if (process.env.NODE_ENV !== 'production') global.__pgPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
```

The `global.__pgPool` cache avoids exhausting connections during Next.js HMR.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json drizzle.config.ts lib/db/client.ts
git commit -m "feat: add drizzle, pg, zod, bcryptjs deps; remove upstash"
```

---

### Task 2: Define schema and generate initial migration

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/migrations/0000_*.sql` (generated)

- [ ] **Step 1: Write schema**

```ts
// lib/db/schema.ts
import {
  pgTable, serial, bigserial, text, integer, boolean, jsonb,
  timestamp, index,
} from 'drizzle-orm/pg-core';

export const jobs = pgTable('jobs', {
  id:             serial('id').primaryKey(),
  slug:           text('slug').notNull().unique(),
  title:          text('title').notNull(),
  url:            text('url').notNull(),
  description:    text('description').notNull(),
  minIntervalS:   integer('min_interval_s').notNull().default(600),
  maxIntervalS:   integer('max_interval_s').notNull().default(1800),
  dayStartHour:   integer('day_start_hour').notNull().default(7),
  dayEndHour:     integer('day_end_hour').notNull().default(23),
  tzOffsetH:      integer('tz_offset_h').notNull().default(7),
  enabled:        boolean('enabled').notNull().default(true),
  customSettings: jsonb('custom_settings').notNull().default({}),
  nextRunAt:      timestamp('next_run_at', { withTimezone: true }),
  lastRunAt:      timestamp('last_run_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipients = pgTable(
  'recipients',
  {
    id:        serial('id').primaryKey(),
    jobId:     integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    name:      text('name').notNull(),
    phone:     text('phone').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({ jobIdx: index('recipients_job_id_idx').on(t.jobId) }),
);

export const runHistory = pgTable(
  'run_history',
  {
    id:                     bigserial('id', { mode: 'number' }).primaryKey(),
    jobId:                  integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    startedAt:              timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt:             timestamp('finished_at', { withTimezone: true }).notNull(),
    status:                 text('status').notNull(),       // 'ok' | 'error' | 'skipped'
    triggerType:            text('trigger_type').notNull(), // 'manual' | 'scheduled'
    skipReason:             text('skip_reason'),            // 'outside_window' | 'lock_busy' | null
    diffMs:                 integer('diff_ms'),
    paidProjects:           integer('paid_projects').notNull().default(0),
    allProjects:            integer('all_projects').notNull().default(0),
    paidQualifications:     integer('paid_qualifications').notNull().default(0),
    allQualifications:      integer('all_qualifications').notNull().default(0),
    newPaidProjects:        integer('new_paid_projects').notNull().default(0),
    newAllProjects:         integer('new_all_projects').notNull().default(0),
    newPaidQualifications:  integer('new_paid_qualifications').notNull().default(0),
    newAllQualifications:   integer('new_all_qualifications').notNull().default(0),
    extractedItems:         jsonb('extracted_items'),
    rawHtml:                text('raw_html'),
    errorMessage:           text('error_message'),
    notificationSent:       boolean('notification_sent').notNull().default(false),
  },
  t => ({ jobStartedIdx: index('run_history_job_started_idx').on(t.jobId, t.startedAt) }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Recipient = typeof recipients.$inferSelect;
export type RunHistory = typeof runHistory.$inferSelect;
```

- [ ] **Step 2: Generate migration**

Run: `npx drizzle-kit generate --name init`
Expected: creates `lib/db/migrations/0000_init.sql` and `meta/0000_snapshot.json`.

- [ ] **Step 3: Inspect generated SQL**

Open `lib/db/migrations/0000_init.sql`. Verify three `CREATE TABLE` statements (jobs, recipients, run_history) and two `CREATE INDEX` statements (recipients_job_id_idx, run_history_job_started_idx) are present.

If anything looks off vs the spec §5, edit the schema file, regenerate (`rm lib/db/migrations/0000_init.sql lib/db/migrations/meta/0000_snapshot.json && npx drizzle-kit generate --name init`).

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/
git commit -m "feat: define jobs/recipients/run_history schema with initial migration"
```

---

### Task 3: Implement crypto module (TDD)

**Files:**
- Create: `lib/crypto.ts`
- Create: `lib/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/crypto.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { encrypt, decrypt } from './crypto';

const KEY = 'a'.repeat(64); // 32 bytes hex
let originalKey: string | undefined;

beforeAll(() => { originalKey = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = KEY; });
afterAll(() => { process.env.ENCRYPTION_KEY = originalKey; });

describe('crypto', () => {
  it('round-trips a plaintext value', () => {
    const plain = 'session_id=abc123; foo=bar';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('produces different ciphertext for the same plaintext (random nonce)', () => {
    const plain = 'same';
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const c = encrypt('hello');
    const [nonce, tag, ct] = c.split(':');
    const flippedCt = Buffer.from(ct, 'base64');
    flippedCt[0] ^= 0xff;
    const tampered = `${nonce}:${tag}:${flippedCt.toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws clearly when ENCRYPTION_KEY is missing', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });
});
```

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run lib/crypto.test.ts`
Expected: failure — module not found.

- [ ] **Step 3: Implement crypto module**

```ts
// lib/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALG = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY is not set');
  if (k.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(k, 'hex');
}

/** Encrypt a UTF-8 string. Returns `base64(nonce):base64(tag):base64(ciphertext)`. */
export function encrypt(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALG, key(), nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${nonce.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt the format produced by `encrypt`. Throws on tampering, missing key, malformed input. */
export function decrypt(packed: string): string {
  const parts = packed.split(':');
  if (parts.length !== 3) throw new Error('Malformed ciphertext');
  const [nonceB64, tagB64, ctB64] = parts;
  const nonce = Buffer.from(nonceB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = createDecipheriv(ALG, key(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run lib/crypto.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/crypto.ts lib/crypto.test.ts
git commit -m "feat: add aes-256-gcm crypto module with auth-tag verification"
```

---

### Task 4: Refactor auth to use bcrypt

**Files:**
- Modify: `app/api/auth/login/route.ts`

- [ ] **Step 1: Rewrite the login route**

Replace the entire file with:
```ts
// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSessionToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminHash) {
    return NextResponse.json({ error: 'Server misconfigured: ADMIN_PASSWORD_HASH missing' }, { status: 500 });
  }
  if (username !== adminUser || !(await bcrypt.compare(password, adminHash))) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSessionToken(username);
  const origin = req.headers.get('origin') ?? new URL(req.url).origin;
  const res = NextResponse.redirect(new URL('/dashboard', origin));
  res.cookies.set('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return res;
}
```

Notes:
- Removed the `RAILWAY_APP_URL` fallback (no longer on Railway).
- Hashed comparison via bcrypt; no plaintext path.
- Refuses to start if `ADMIN_PASSWORD_HASH` is unset (loud failure beats silent default).

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to this file. (Other unrelated errors may exist from later tasks — fine for now.)

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/login/route.ts
git commit -m "feat(auth): switch login to bcrypt-hashed ADMIN_PASSWORD_HASH"
```

---

## Phase 2 — Job Module Contract and Scheduler

### Task 5: Define job module types and registry

**Files:**
- Create: `lib/jobs/types.ts`
- Create: `lib/jobs/registry.ts`

- [ ] **Step 1: Write the types**

```ts
// lib/jobs/types.ts
import type { ComponentType } from 'react';
import type { ZodSchema } from 'zod';
import type { db } from '@/lib/db/client';

export interface PaidItem {
  id: string;
  name: string;
  pay: string;
  availableTasksFor: string;
  created: string;
  qualification: boolean;
}

export interface RunContext {
  jobId: number;
  meta: { title: string; url: string; description: string };
  custom: unknown;                       // typed per-job via customSettingsSchema
  db: typeof db;
  recipients: { id: number; name: string; phone: string }[];
  lastSuccessfulItems: PaidItem[];
}

export type RunStatus = 'ok' | 'error' | 'skipped';

export interface RunResult {
  status: RunStatus;
  paidProjects: number;            allProjects: number;
  paidQualifications: number;      allQualifications: number;
  newPaidProjects: number;         newAllProjects: number;
  newPaidQualifications: number;   newAllQualifications: number;
  extractedItems: PaidItem[];
  rawHtml?: string;
  errorMessage?: string;
  notificationSent: boolean;
}

export interface JobModule {
  slug: string;
  defaultMeta: { title: string; url: string; description: string };
  customSettingsSchema?: ZodSchema;
  CustomSettingsPanel?: ComponentType<{ jobId: number; current: unknown }>;
  runCheck(ctx: RunContext): Promise<RunResult>;
}
```

- [ ] **Step 2: Write empty registry (DA added in Task 11)**

```ts
// lib/jobs/registry.ts
import type { JobModule } from './types';

export const jobRegistry: JobModule[] = [];

export function getJob(slug: string): JobModule | undefined {
  return jobRegistry.find(j => j.slug === slug);
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/jobs/types.ts lib/jobs/registry.ts
git commit -m "feat: define JobModule contract and empty registry"
```

---

### Task 6: Implement scheduling math (TDD)

**Files:**
- Create: `lib/scheduler/window.ts`
- Create: `lib/scheduler/window.test.ts`

The pure math: given an instant `now`, the job's window (`dayStartHour`, `dayEndHour`, `tzOffsetH`), and (`minIntervalS`, `maxIntervalS`), compute the next run instant.

**Window semantics:** `dayStartHour <= localHour < dayEndHour` (left-inclusive, right-exclusive). So `7..23` means hours 7, 8, ..., 22. Hour 23 is outside.

- [ ] **Step 1: Write failing tests**

```ts
// lib/scheduler/window.test.ts
import { describe, it, expect } from 'vitest';
import {
  isWithinWindow, nextWindowOpening, jitter, computeNextRunAt,
} from './window';

const W = { dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7 }; // WIB

// Helper to build a UTC instant given a WIB wall-clock.
const wib = (yyyy: number, mm: number, dd: number, h: number, min = 0) =>
  new Date(Date.UTC(yyyy, mm - 1, dd, h - 7, min));

describe('isWithinWindow', () => {
  it('returns true at the start hour exactly', () => {
    expect(isWithinWindow(wib(2026, 6, 1, 7, 0), W)).toBe(true);
  });
  it('returns false just before the start hour', () => {
    expect(isWithinWindow(wib(2026, 6, 1, 6, 59), W)).toBe(false);
  });
  it('returns true at the last in-window minute', () => {
    expect(isWithinWindow(wib(2026, 6, 1, 22, 59), W)).toBe(true);
  });
  it('returns false at the end hour exactly (right-exclusive)', () => {
    expect(isWithinWindow(wib(2026, 6, 1, 23, 0), W)).toBe(false);
  });
});

describe('nextWindowOpening', () => {
  it('returns same-day start when called before window opens', () => {
    expect(nextWindowOpening(wib(2026, 6, 1, 5, 30), W).toISOString())
      .toBe(wib(2026, 6, 1, 7, 0).toISOString());
  });
  it('returns next-day start when called after window closes', () => {
    expect(nextWindowOpening(wib(2026, 6, 1, 23, 30), W).toISOString())
      .toBe(wib(2026, 6, 2, 7, 0).toISOString());
  });
});

describe('jitter', () => {
  it('returns a value in [min, max] inclusive', () => {
    for (let i = 0; i < 1000; i++) {
      const v = jitter(600, 1800);
      expect(v).toBeGreaterThanOrEqual(600);
      expect(v).toBeLessThanOrEqual(1800);
    }
  });
  it('returns the bound when min===max', () => {
    expect(jitter(500, 500)).toBe(500);
  });
});

describe('computeNextRunAt', () => {
  it('uses jitter when result lands inside the window', () => {
    const now = wib(2026, 6, 1, 12, 0);
    const out = computeNextRunAt(now, { ...W, minIntervalS: 600, maxIntervalS: 600 });
    expect(out.toISOString()).toBe(wib(2026, 6, 1, 12, 10).toISOString());
  });
  it('clamps to next window opening when jitter overshoots the window end', () => {
    const now = wib(2026, 6, 1, 22, 50);
    // min=max=1800s (30min) => raw next = 23:20 (outside). Clamp to next day 07:00.
    const out = computeNextRunAt(now, { ...W, minIntervalS: 1800, maxIntervalS: 1800 });
    expect(out.toISOString()).toBe(wib(2026, 6, 2, 7, 0).toISOString());
  });
  it('clamps to next window opening when called outside the window', () => {
    const now = wib(2026, 6, 1, 3, 0);
    const out = computeNextRunAt(now, { ...W, minIntervalS: 600, maxIntervalS: 1800 });
    expect(out.toISOString()).toBe(wib(2026, 6, 1, 7, 0).toISOString());
  });
});
```

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run lib/scheduler/window.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement window math**

```ts
// lib/scheduler/window.ts
export interface Window {
  dayStartHour: number;   // 0–23
  dayEndHour:   number;   // 0–23, right-exclusive
  tzOffsetH:    number;   // hours offset from UTC
}

export interface JitterCfg {
  minIntervalS: number;
  maxIntervalS: number;
}

function localHour(d: Date, tzOffsetH: number): number {
  return new Date(d.getTime() + tzOffsetH * 3600 * 1000).getUTCHours();
}

export function isWithinWindow(now: Date, w: Window): boolean {
  const h = localHour(now, w.tzOffsetH);
  return h >= w.dayStartHour && h < w.dayEndHour;
}

/** The next `dayStartHour:00` local-time instant at or after `now`. */
export function nextWindowOpening(now: Date, w: Window): Date {
  const local = new Date(now.getTime() + w.tzOffsetH * 3600 * 1000);
  // Build a local instant for today's start.
  const todayStartLocal = new Date(Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(),
    w.dayStartHour, 0, 0,
  ));
  const todayStartUtc = new Date(todayStartLocal.getTime() - w.tzOffsetH * 3600 * 1000);
  if (todayStartUtc.getTime() > now.getTime()) return todayStartUtc;
  // Already past today's opening — next opening is tomorrow's.
  return new Date(todayStartUtc.getTime() + 24 * 3600 * 1000);
}

export function jitter(minS: number, maxS: number): number {
  if (minS > maxS) throw new Error('minIntervalS > maxIntervalS');
  return Math.floor(Math.random() * (maxS - minS + 1)) + minS;
}

export function computeNextRunAt(now: Date, cfg: Window & JitterCfg): Date {
  if (!isWithinWindow(now, cfg)) return nextWindowOpening(now, cfg);
  const raw = new Date(now.getTime() + jitter(cfg.minIntervalS, cfg.maxIntervalS) * 1000);
  if (!isWithinWindow(raw, cfg)) return nextWindowOpening(raw, cfg);
  return raw;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/scheduler/window.test.ts`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduler/window.ts lib/scheduler/window.test.ts
git commit -m "feat(scheduler): pure jitter + active-window math, fully unit-tested"
```

---

### Task 7: Postgres advisory lock helpers

**Files:**
- Create: `lib/scheduler/lock.ts`

- [ ] **Step 1: Write the module**

```ts
// lib/scheduler/lock.ts
// Uses pg-session-level advisory locks. Caller must use a dedicated client
// (checked out via pool.connect) so the lock binds to that session.
// Locks auto-release on session close (process crash safety).
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/client';

export async function withJobLock<T>(
  jobId: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS ok', [jobId],
    );
    if (!r.rows[0].ok) return { acquired: false };
    try {
      const value = await fn(client);
      return { acquired: true, value };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [jobId]);
    }
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: TS check**

Run: `npx tsc --noEmit`
Expected: no errors for this file.

- [ ] **Step 3: Commit**

```bash
git add lib/scheduler/lock.ts
git commit -m "feat(scheduler): session-scoped postgres advisory lock wrapper"
```

---

### Task 8: Implement the scheduler singleton

**Files:**
- Create: `lib/scheduler/index.ts`

The scheduler exports `start()`, `runJob(jobId, opts)`, `reschedule(jobId)`, `stop()`. Holds one `setTimeout` per job in a `Map<number, NodeJS.Timeout>`. Calls `runCheck` from the job module, writes `run_history`, computes `nextRunAt`, re-arms.

- [ ] **Step 1: Write the scheduler**

```ts
// lib/scheduler/index.ts
import { eq, desc, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, recipients, runHistory, type Job, type RunHistory } from '@/lib/db/schema';
import { getJob } from '@/lib/jobs/registry';
import type { PaidItem, RunResult, RunStatus } from '@/lib/jobs/types';
import { computeNextRunAt, isWithinWindow } from './window';
import { withJobLock } from './lock';
import { WahaClient } from '@/lib/waha';

const timers = new Map<number, NodeJS.Timeout>();
let started = false;

type Trigger = 'scheduled' | 'manual';

export interface ManualRunOutcome {
  status: 'ran' | 'lock_busy';
  result?: RunResult;
}

/** Boot the scheduler. Idempotent. */
export async function start(): Promise<void> {
  if (started) return;
  started = true;
  const all = await db.select().from(jobs).where(eq(jobs.enabled, true));
  for (const job of all) await armTimer(job.id);
  process.on('unhandledRejection', err => {
    console.error('[scheduler] unhandledRejection', err);
  });
}

/** Stop all timers (for tests / shutdown). */
export function stop(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  started = false;
}

/** Re-read job from DB and re-arm its timer. Call after settings change. */
export async function reschedule(jobId: number): Promise<void> {
  const existing = timers.get(jobId);
  if (existing) { clearTimeout(existing); timers.delete(jobId); }
  await armTimer(jobId);
}

/** Manual run (HTTP-triggered). Returns lock_busy if a scheduled run is in flight. */
export async function runManual(jobId: number): Promise<ManualRunOutcome> {
  const r = await executeRun(jobId, 'manual');
  if (r.kind === 'lock_busy') return { status: 'lock_busy' };
  return { status: 'ran', result: r.result };
}

// ---------- internals ----------

async function armTimer(jobId: number): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || !job.enabled) return;

  const now = new Date();
  let target = job.nextRunAt;
  if (!target || target.getTime() <= now.getTime()) {
    target = computeNextRunAt(now, jobCfg(job));
    await db.update(jobs).set({ nextRunAt: target, updatedAt: now }).where(eq(jobs.id, jobId));
  }
  const delay = Math.max(0, target.getTime() - now.getTime());
  const t = setTimeout(() => { void onTimerFire(jobId); }, delay);
  timers.set(jobId, t);
}

async function onTimerFire(jobId: number): Promise<void> {
  try {
    await executeRun(jobId, 'scheduled');
  } catch (err) {
    console.error(`[scheduler] timer fire failed for job ${jobId}`, err);
  } finally {
    await scheduleNext(jobId);
  }
}

async function scheduleNext(jobId: number): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || !job.enabled) return;
  const next = computeNextRunAt(new Date(), jobCfg(job));
  await db.update(jobs).set({ nextRunAt: next, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  const existing = timers.get(jobId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => { void onTimerFire(jobId); }, Math.max(0, next.getTime() - Date.now()));
  timers.set(jobId, t);
}

type ExecOutcome =
  | { kind: 'lock_busy' }
  | { kind: 'skipped'; reason: 'outside_window' }
  | { kind: 'ran'; result: RunResult };

async function executeRun(jobId: number, trigger: Trigger): Promise<ExecOutcome> {
  const outcome = await withJobLock(jobId, async () => {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Outside-window: scheduled runs skip; manual runs bypass.
    if (trigger === 'scheduled' && !isWithinWindow(new Date(), jobCfg(job))) {
      const started = new Date();
      await db.insert(runHistory).values({
        jobId, startedAt: started, finishedAt: started,
        status: 'skipped', triggerType: trigger, skipReason: 'outside_window',
        diffMs: await diffSincePrevRun(jobId, started),
      });
      return { kind: 'skipped', reason: 'outside_window' as const };
    }

    const module = getJob(job.slug);
    if (!module) {
      const started = new Date();
      await db.insert(runHistory).values({
        jobId, startedAt: started, finishedAt: started,
        status: 'error', triggerType: trigger,
        errorMessage: `No JobModule registered for slug '${job.slug}'`,
        diffMs: await diffSincePrevRun(jobId, started),
      });
      return { kind: 'ran', result: errorResult(`No JobModule for ${job.slug}`) };
    }

    const recps = await db.select().from(recipients).where(eq(recipients.jobId, jobId));
    const lastSuccess = await loadLastSuccessfulItems(jobId);
    const startedAt = new Date();
    let result: RunResult;
    try {
      result = await module.runCheck({
        jobId,
        meta: { title: job.title, url: job.url, description: job.description },
        custom: job.customSettings,
        db,
        recipients: recps.map(r => ({ id: r.id, name: r.name, phone: r.phone })),
        lastSuccessfulItems: lastSuccess,
      });
    } catch (err) {
      result = errorResult(err instanceof Error ? err.message : String(err));
    }
    const finishedAt = new Date();
    await db.insert(runHistory).values({
      jobId, startedAt, finishedAt,
      status: result.status, triggerType: trigger,
      diffMs: await diffSincePrevRun(jobId, startedAt),
      paidProjects: result.paidProjects, allProjects: result.allProjects,
      paidQualifications: result.paidQualifications, allQualifications: result.allQualifications,
      newPaidProjects: result.newPaidProjects, newAllProjects: result.newAllProjects,
      newPaidQualifications: result.newPaidQualifications, newAllQualifications: result.newAllQualifications,
      extractedItems: result.status === 'ok' ? result.extractedItems : null,
      rawHtml: result.status === 'error' ? result.rawHtml ?? null : null,
      errorMessage: result.errorMessage ?? null,
      notificationSent: result.notificationSent,
    });
    await db.update(jobs).set({ lastRunAt: finishedAt, updatedAt: finishedAt }).where(eq(jobs.id, jobId));

    if (result.status === 'error') await maybeAlertFailureStreak(jobId, result.errorMessage ?? 'unknown');
    return { kind: 'ran', result };
  });

  if (!outcome.acquired) {
    // For scheduled, write a skipped row; for manual, the route handler will translate to 409.
    if (trigger === 'scheduled') {
      const t = new Date();
      await db.insert(runHistory).values({
        jobId, startedAt: t, finishedAt: t,
        status: 'skipped', triggerType: trigger, skipReason: 'lock_busy',
        diffMs: await diffSincePrevRun(jobId, t),
      });
    }
    return { kind: 'lock_busy' };
  }
  return outcome.value;
}

function jobCfg(job: Job) {
  return {
    dayStartHour: job.dayStartHour,
    dayEndHour:   job.dayEndHour,
    tzOffsetH:    job.tzOffsetH,
    minIntervalS: job.minIntervalS,
    maxIntervalS: job.maxIntervalS,
  };
}

async function diffSincePrevRun(jobId: number, now: Date): Promise<number | null> {
  const [prev] = await db.select({ startedAt: runHistory.startedAt })
    .from(runHistory).where(eq(runHistory.jobId, jobId))
    .orderBy(desc(runHistory.startedAt)).limit(1);
  return prev ? now.getTime() - prev.startedAt.getTime() : null;
}

async function loadLastSuccessfulItems(jobId: number): Promise<PaidItem[]> {
  const [row] = await db.select({ extractedItems: runHistory.extractedItems })
    .from(runHistory)
    .where(and(eq(runHistory.jobId, jobId), eq(runHistory.status, 'ok')))
    .orderBy(desc(runHistory.startedAt)).limit(1);
  return (row?.extractedItems as PaidItem[] | null) ?? [];
}

async function maybeAlertFailureStreak(jobId: number, latestError: string): Promise<void> {
  const FAIL_LIMIT = 3;
  const rows = await db.select({ status: runHistory.status })
    .from(runHistory).where(eq(runHistory.jobId, jobId))
    .orderBy(desc(runHistory.startedAt)).limit(FAIL_LIMIT + 1);
  const lastN = rows.slice(0, FAIL_LIMIT);
  if (lastN.length < FAIL_LIMIT) return;
  if (!lastN.every(r => r.status === 'error')) return;
  // Skip re-alert if the streak was already 3 before this run (i.e. row #4 is also error).
  if (rows[FAIL_LIMIT]?.status === 'error') return;

  const recps = await db.select().from(recipients).where(eq(recipients.jobId, jobId));
  if (!recps.length) return;
  const wahaUrl = process.env.WAHA_URL;
  if (!wahaUrl) return;
  const waha = new WahaClient(wahaUrl, process.env.WAHA_API_KEY ?? '');
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const msg =
    `⚠️ *Scraper Alert* ⚠️\n\n` +
    `${job?.title ?? 'Job'} has failed *${FAIL_LIMIT}× consecutively*.\n\n` +
    `*Latest error:* ${latestError}\n\n` +
    `_Please check the job settings (cookie, URL)._`;
  for (const r of recps) {
    try { await waha.sendText(r.phone, msg); }
    catch (e) { console.error(`[scheduler] failure-alert send failed for ${r.phone}`, e); }
  }
}

function errorResult(message: string): RunResult {
  return {
    status: 'error',
    paidProjects: 0, allProjects: 0,
    paidQualifications: 0, allQualifications: 0,
    newPaidProjects: 0, newAllProjects: 0,
    newPaidQualifications: 0, newAllQualifications: 0,
    extractedItems: [], errorMessage: message, notificationSent: false,
  };
}

export type { RunResult } from '@/lib/jobs/types';
```

- [ ] **Step 2: TS check**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/scheduler/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/scheduler/index.ts
git commit -m "feat(scheduler): singleton with timers, lock, history insert, 3-strike alert"
```

---

### Task 9: Wire scheduler boot into `instrumentation.ts`

**Files:**
- Create: `instrumentation.ts`
- Create: `lib/db/migrate.ts`

- [ ] **Step 1: Programmatic migration runner**

```ts
// lib/db/migrate.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './lib/db/migrations' });
  await pool.end();
}
```

- [ ] **Step 2: Write `instrumentation.ts`**

```ts
// instrumentation.ts
// Runs once per Next.js server instance boot, before serving requests.
// Node runtime only (skipped on Edge).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runMigrations } = await import('./lib/db/migrate');
  const { seedRegistryJobs } = await import('./lib/jobs/seed');
  const { start } = await import('./lib/scheduler');

  await runMigrations();
  await seedRegistryJobs();
  await start();
}
```

- [ ] **Step 3: Write `lib/jobs/seed.ts`**

```ts
// lib/jobs/seed.ts
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { jobRegistry } from './registry';

export async function seedRegistryJobs(): Promise<void> {
  for (const mod of jobRegistry) {
    const [existing] = await db.select().from(jobs).where(eq(jobs.slug, mod.slug)).limit(1);
    if (existing) continue;
    await db.insert(jobs).values({
      slug: mod.slug,
      title: mod.defaultMeta.title,
      url: mod.defaultMeta.url,
      description: mod.defaultMeta.description,
      // defaults for intervals/window come from the schema
    });
  }
  // Orphans (DB rows with a slug no longer in the registry) are left alone — see spec §2 Non-Goals.
}
```

- [ ] **Step 4: TS check**

Run: `npx tsc --noEmit`
Expected: no errors in these new files. (Registry is still empty — boot will be a no-op until Task 11.)

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts lib/db/migrate.ts lib/jobs/seed.ts
git commit -m "feat: instrumentation boot hook — migrate, seed registry, start scheduler"
```

---

## Phase 3 — Port the DataAnnotation Job

### Task 10: Move and refactor DA into a JobModule

**Files:**
- Create: `lib/jobs/data-annotation/index.ts`
- Create: `lib/jobs/data-annotation/fetch.ts` (copy of existing)
- Create: `lib/jobs/data-annotation/parse.ts` (copy of existing)
- Create: `lib/jobs/data-annotation/format.ts` (copy of existing)
- Create: `lib/jobs/data-annotation/diff.ts` (new — see Task 11)
- Modify: `lib/jobs/registry.ts`

(The existing `lib/checkers/dataannotation/*` files stay for now and get deleted in Task 22 once everything is wired.)

- [ ] **Step 1: Copy fetch.ts and parse.ts unchanged**

```bash
mkdir -p lib/jobs/data-annotation
cp lib/checkers/dataannotation/fetch.ts lib/jobs/data-annotation/fetch.ts
cp lib/checkers/dataannotation/parse.ts lib/jobs/data-annotation/parse.ts
cp lib/checkers/dataannotation/format.ts lib/jobs/data-annotation/format.ts
```

- [ ] **Step 2: Write the JobModule index**

```ts
// lib/jobs/data-annotation/index.ts
import { z } from 'zod';
import dynamic from 'next/dynamic';
import { fetchDataAnnotationPage } from './fetch';
import { parseDataAnnotation, extractPaidItems, isPaidItem } from './parse';
import { formatNotification } from './format';
import { diffNewItems } from './diff';
import { decrypt } from '@/lib/crypto';
import { WahaClient } from '@/lib/waha';
import type { JobModule, RunContext, RunResult } from '../types';

export const customSettingsSchema = z.object({
  cookie_encrypted: z.string().optional(),
});
type Custom = z.infer<typeof customSettingsSchema>;

const CustomSettingsPanel = dynamic(() => import('./settings-panel'), { ssr: false });

function hasTasks(s: string): boolean {
  return parseInt(s.replace(/\D/g, '') || '0', 10) > 0;
}

export const dataAnnotation: JobModule = {
  slug: 'data-annotation',
  defaultMeta: {
    title: 'Data Annotation',
    url: 'https://app.dataannotation.tech/workers/projects',
    description: 'Monitor paid projects and qualifications on DataAnnotation.',
  },
  customSettingsSchema,
  CustomSettingsPanel,

  async runCheck(ctx: RunContext): Promise<RunResult> {
    const custom = customSettingsSchema.parse(ctx.custom ?? {});
    if (!custom.cookie_encrypted) {
      return mkError('No cookie configured — open settings and paste your session cookie.');
    }
    let cookie: string;
    try { cookie = decrypt(custom.cookie_encrypted); }
    catch { return mkError('cookie unreadable — re-enter via UI'); }

    let html: string;
    try { html = await fetchDataAnnotationPage(cookie); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401') || msg.includes('403')) {
        return mkError('Auth expired — please update cookie', html ?? '');
      }
      return mkError(`Fetch failed: ${msg}`, html ?? '');
    }

    const props = parseDataAnnotation(html);
    if (!props) return mkError(`Failed to parse response (HTML length: ${html.length})`, html);

    const items = extractPaidItems(props);
    const newItems = diffNewItems(items, ctx.lastSuccessfulItems);

    const allProjects = items.filter(i => !i.qualification).length;
    const allQuals    = items.filter(i =>  i.qualification).length;
    const paidProjects = items.filter(i => !i.qualification && isPaidStr(i.pay)).length;
    const paidQuals    = items.filter(i =>  i.qualification && isPaidStr(i.pay)).length;

    const newAllProjects = newItems.filter(i => !i.qualification).length;
    const newAllQuals    = newItems.filter(i =>  i.qualification).length;
    const newPaidProjects = newItems.filter(i => !i.qualification && isPaidStr(i.pay)).length;
    const newPaidQuals    = newItems.filter(i =>  i.qualification && isPaidStr(i.pay)).length;

    // Notification trigger (spec §2 Goals): new_paid_projects > 0 OR new_all_qualifications > 0.
    let notificationSent = false;
    if (newPaidProjects > 0 || newAllQuals > 0) {
      const wahaUrl = process.env.WAHA_URL;
      if (wahaUrl && ctx.recipients.length) {
        const waha = new WahaClient(wahaUrl, process.env.WAHA_API_KEY ?? '');
        const msg = formatNotification(newItems);
        for (const r of ctx.recipients) {
          try { await waha.sendText(r.phone, msg); notificationSent = true; }
          catch (e) { console.error(`[da] waha send failed for ${r.phone}`, e); }
        }
      }
    }

    return {
      status: 'ok',
      paidProjects, allProjects,
      paidQualifications: paidQuals, allQualifications: allQuals,
      newPaidProjects,   newAllProjects,
      newPaidQualifications: newPaidQuals, newAllQualifications: newAllQuals,
      extractedItems: items,
      notificationSent,
    };
  },
};

function isPaidStr(pay: string): boolean { return pay?.includes('$') ?? false; }

function mkError(message: string, rawHtml?: string): RunResult {
  return {
    status: 'error',
    paidProjects: 0, allProjects: 0,
    paidQualifications: 0, allQualifications: 0,
    newPaidProjects: 0, newAllProjects: 0,
    newPaidQualifications: 0, newAllQualifications: 0,
    extractedItems: [], errorMessage: message, rawHtml, notificationSent: false,
  };
}
```

Note on `hasTasks` import: only `parse.ts` uses it internally — no need to re-export. If TS complains about an unused import, remove the local `hasTasks` function (it's leftover from the old index).

- [ ] **Step 3: Register the module**

Update `lib/jobs/registry.ts`:
```ts
import type { JobModule } from './types';
import { dataAnnotation } from './data-annotation';

export const jobRegistry: JobModule[] = [dataAnnotation];

export function getJob(slug: string): JobModule | undefined {
  return jobRegistry.find(j => j.slug === slug);
}
```

- [ ] **Step 4: Add settings-panel.tsx stub**

```tsx
// lib/jobs/data-annotation/settings-panel.tsx
'use client';
import { useState } from 'react';

interface Props { jobId: number; current: unknown }

export default function DASettingsPanel({ jobId, current }: Props) {
  const c = (current ?? {}) as { cookie_preview?: string };
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/data-annotation/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ custom: { cookie: value } }),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${res.status}`);
    if (res.ok) setValue('');
  };

  return (
    <div className="space-y-3 border rounded p-4">
      <h3 className="font-semibold">DataAnnotation cookie</h3>
      {c.cookie_preview && (
        <div className="text-sm text-gray-600">Stored: <code>{c.cookie_preview}</code></div>
      )}
      <textarea
        className="w-full border rounded p-2 text-sm font-mono"
        rows={3}
        placeholder="Paste full session cookie..."
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button
        disabled={busy || !value}
        onClick={save}
        className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
      >Save cookie</button>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
```

(The `cookie_preview` field is computed by the GET route in Task 16. The panel never displays the raw cookie.)

- [ ] **Step 5: TS check**

Run: `npx tsc --noEmit`
Expected: no errors. `diffNewItems` doesn't exist yet → expect that one error to remain until Task 11.

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/data-annotation/ lib/jobs/registry.ts
git commit -m "feat(jobs/data-annotation): port to JobModule contract"
```

---

### Task 11: Implement the "new item" diff rule (TDD)

**Files:**
- Create: `lib/jobs/data-annotation/diff.ts`
- Create: `lib/jobs/data-annotation/diff.test.ts`

The rule (spec §2): a current item is *new* if its `id` is absent from `lastSuccessfulItems`. Appear → disappear → reappear counts as new because the disappearance left it out of the most recent successful run.

- [ ] **Step 1: Write failing tests**

```ts
// lib/jobs/data-annotation/diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffNewItems } from './diff';
import type { PaidItem } from '@/lib/jobs/types';

const item = (id: string, qual = false): PaidItem => ({
  id, name: id, pay: '$10', availableTasksFor: '5', created: '', qualification: qual,
});

describe('diffNewItems', () => {
  it('returns items present now but absent in last successful run', () => {
    const prev = [item('a')];
    const curr = [item('a'), item('b')];
    expect(diffNewItems(curr, prev).map(i => i.id)).toEqual(['b']);
  });

  it('returns nothing when current is a subset of previous', () => {
    expect(diffNewItems([item('a')], [item('a'), item('b')])).toEqual([]);
  });

  it('treats appear → disappear → reappear as NEW (spec rule)', () => {
    // last successful run contained only ['b']; current shows ['a','b']; 'a' was there before
    // its disappearance, but absent in the LAST SUCCESSFUL run, so it is new again.
    const lastSuccessful = [item('b')];
    const curr = [item('a'), item('b')];
    expect(diffNewItems(curr, lastSuccessful).map(i => i.id)).toEqual(['a']);
  });

  it('returns all current items when there is no previous successful run', () => {
    expect(diffNewItems([item('a'), item('b')], []).map(i => i.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run lib/jobs/data-annotation/diff.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// lib/jobs/data-annotation/diff.ts
import type { PaidItem } from '@/lib/jobs/types';

export function diffNewItems(current: PaidItem[], lastSuccessful: PaidItem[]): PaidItem[] {
  const prev = new Set(lastSuccessful.map(i => i.id));
  return current.filter(i => !prev.has(i.id));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/jobs/data-annotation/diff.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Run all tests to confirm nothing else broke**

Run: `npx vitest run`
Expected: all green (crypto + window + diff tests).

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/data-annotation/diff.ts lib/jobs/data-annotation/diff.test.ts
git commit -m "feat(jobs/data-annotation): diff rule (absent in last successful run = new)"
```

---

## Phase 4 — API Routes

### Task 12: Shared auth helper for API routes

**Files:**
- Create: `lib/api/require-session.ts`

- [ ] **Step 1: Write the helper**

```ts
// lib/api/require-session.ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken, type SessionPayload } from '@/lib/auth';

export async function requireSession(): Promise<
  { ok: true; session: SessionPayload } | { ok: false; res: NextResponse }
> {
  const store = await cookies();
  const token = store.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { ok: true, session };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/api/require-session.ts
git commit -m "feat(api): shared session-guard helper"
```

---

### Task 13: POST `/api/jobs/[slug]/run` — manual run

**Files:**
- Create: `app/api/jobs/[slug]/run/route.ts`

- [ ] **Step 1: Write the route**

```ts
// app/api/jobs/[slug]/run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { runManual } from '@/lib/scheduler';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const out = await runManual(job.id);
  if (out.status === 'lock_busy') {
    return NextResponse.json({ error: 'A run is already in progress' }, { status: 409 });
  }
  return NextResponse.json({ status: 'ran', result: out.result });
}
```

(`params` is a Promise in Next.js 16 — note the `await params`.)

- [ ] **Step 2: TS check**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add app/api/jobs/
git commit -m "feat(api): POST /api/jobs/[slug]/run (manual trigger)"
```

---

### Task 14: PATCH `/api/jobs/[slug]/settings`

**Files:**
- Create: `app/api/jobs/[slug]/settings/route.ts`

- [ ] **Step 1: Write the route**

```ts
// app/api/jobs/[slug]/settings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { encrypt } from '@/lib/crypto';
import { getJob } from '@/lib/jobs/registry';
import { reschedule } from '@/lib/scheduler';

const metaSchema = z.object({
  title:       z.string().min(1).optional(),
  url:         z.string().url().optional(),
  description: z.string().optional(),
}).strict();

const scheduleSchema = z.object({
  minIntervalS: z.number().int().min(30).max(86400).optional(),
  maxIntervalS: z.number().int().min(30).max(86400).optional(),
  dayStartHour: z.number().int().min(0).max(23).optional(),
  dayEndHour:   z.number().int().min(1).max(24).optional(),
  tzOffsetH:    z.number().int().min(-12).max(14).optional(),
  enabled:      z.boolean().optional(),
}).strict();

// `custom` is validated by the JobModule's customSettingsSchema.
const bodySchema = z.object({
  meta:     metaSchema.optional(),
  schedule: scheduleSchema.optional(),
  custom:   z.record(z.unknown()).optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  const { slug } = await params;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const mod = getJob(slug);
  if (!mod) return NextResponse.json({ error: 'no registered module' }, { status: 500 });

  // Build the new custom_settings blob.
  let newCustom = job.customSettings as Record<string, unknown>;
  if (body.custom) {
    // Per-job transforms: anything ending in `_plain` is encrypted into `<key>_encrypted`.
    // DA uses { cookie: '...' } → stored as { cookie_encrypted: '...' }.
    const incoming: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.custom)) {
      if (k === 'cookie' && typeof v === 'string') {
        incoming.cookie_encrypted = encrypt(v);
      } else {
        incoming[k] = v;
      }
    }
    newCustom = { ...newCustom, ...incoming };

    if (mod.customSettingsSchema) {
      const r = mod.customSettingsSchema.safeParse(newCustom);
      if (!r.success) return NextResponse.json({ error: r.error.issues }, { status: 400 });
    }
  }

  // Validate cross-field: minIntervalS <= maxIntervalS.
  const min = body.schedule?.minIntervalS ?? job.minIntervalS;
  const max = body.schedule?.maxIntervalS ?? job.maxIntervalS;
  if (min > max) return NextResponse.json({ error: 'minIntervalS > maxIntervalS' }, { status: 400 });

  const startH = body.schedule?.dayStartHour ?? job.dayStartHour;
  const endH   = body.schedule?.dayEndHour   ?? job.dayEndHour;
  if (startH >= endH) return NextResponse.json({ error: 'dayStartHour >= dayEndHour' }, { status: 400 });

  await db.update(jobs).set({
    ...(body.meta ?? {}),
    ...(body.schedule ?? {}),
    customSettings: newCustom,
    updatedAt: new Date(),
  }).where(eq(jobs.id, job.id));

  // Reschedule if interval/window/enabled changed (cheap: just always reschedule on any change).
  await reschedule(job.id);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/jobs/[slug]/settings/
git commit -m "feat(api): PATCH /api/jobs/[slug]/settings (meta, schedule, custom)"
```

---

### Task 15: Recipients CRUD + send-test

**Files:**
- Create: `app/api/jobs/[slug]/recipients/route.ts`
- Create: `app/api/jobs/[slug]/recipients/[id]/route.ts`
- Create: `app/api/jobs/[slug]/recipients/[id]/test/route.ts`

- [ ] **Step 1: Collection route (GET list + POST create)**

```ts
// app/api/jobs/[slug]/recipients/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';

const create = z.object({
  name:  z.string().min(1),
  phone: z.string().min(5),
});

async function getJobOr404(slug: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  return job ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const job = await getJobOr404(slug);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  const rows = await db.select().from(recipients).where(eq(recipients.jobId, job.id));
  return NextResponse.json({ recipients: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const job = await getJobOr404(slug);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const parsed = create.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const [row] = await db.insert(recipients)
    .values({ jobId: job.id, name: parsed.data.name, phone: parsed.data.phone })
    .returning();
  return NextResponse.json({ recipient: row }, { status: 201 });
}
```

- [ ] **Step 2: Item route (PUT update + DELETE)**

```ts
// app/api/jobs/[slug]/recipients/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';

const update = z.object({ name: z.string().min(1).optional(), phone: z.string().min(5).optional() });

async function lookup(slug: string, id: number) {
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return null;
  const [row] = await db.select().from(recipients)
    .where(and(eq(recipients.id, id), eq(recipients.jobId, job.id))).limit(1);
  return row ?? null;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug, id } = await params;
  const recId = Number(id);
  if (!Number.isInteger(recId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const existing = await lookup(slug, recId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const parsed = update.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const [row] = await db.update(recipients).set(parsed.data)
    .where(eq(recipients.id, recId)).returning();
  return NextResponse.json({ recipient: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug, id } = await params;
  const recId = Number(id);
  if (!Number.isInteger(recId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const existing = await lookup(slug, recId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await db.delete(recipients).where(eq(recipients.id, recId));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Send-test route**

```ts
// app/api/jobs/[slug]/recipients/[id]/test/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { WahaClient } from '@/lib/waha';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug, id } = await params;
  const recId = Number(id);
  if (!Number.isInteger(recId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const [row] = await db.select().from(recipients)
    .where(and(eq(recipients.id, recId), eq(recipients.jobId, job.id))).limit(1);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const wahaUrl = process.env.WAHA_URL;
  if (!wahaUrl) return NextResponse.json({ error: 'WAHA_URL not configured' }, { status: 500 });
  const waha = new WahaClient(wahaUrl, process.env.WAHA_API_KEY ?? '');
  try {
    await waha.sendText(row.phone, `✅ Test message from ${job.title} (auto-checker)`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/jobs/[slug]/recipients/
git commit -m "feat(api): recipients CRUD + send-test routes"
```

---

### Task 16: GET `/api/jobs/[slug]/history` (paginated)

**Files:**
- Create: `app/api/jobs/[slug]/history/route.ts`
- Create: `app/api/jobs/[slug]/route.ts` (GET job detail incl. cookie preview)

- [ ] **Step 1: Job detail route (used by the shell page)**

```ts
// app/api/jobs/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { decrypt } from '@/lib/crypto';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  // Build a masked preview of any secret fields in custom_settings.
  // Convention: any field ending in `_encrypted` produces a `_preview` sibling on the wire.
  const custom = (job.customSettings ?? {}) as Record<string, unknown>;
  const customOut: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(custom)) {
    if (k.endsWith('_encrypted') && typeof v === 'string') {
      try {
        const plain = decrypt(v);
        const previewKey = k.replace(/_encrypted$/, '_preview');
        customOut[previewKey] = mask(plain);
      } catch { /* unreadable secret — omit preview */ }
    } else {
      customOut[k] = v;
    }
  }

  // Never include the raw ciphertext OR plaintext in the response.
  return NextResponse.json({
    job: {
      id: job.id, slug: job.slug,
      title: job.title, url: job.url, description: job.description,
      minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
      dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
      enabled: job.enabled,
      nextRunAt: job.nextRunAt, lastRunAt: job.lastRunAt,
      custom: customOut,
    },
  });
}

function mask(s: string): string {
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
}
```

- [ ] **Step 2: History route**

```ts
// app/api/jobs/[slug]/history/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const url = new URL(req.url);
  const page     = Math.max(1,  parseInt(url.searchParams.get('page')     ?? '1',  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '25', 10)));
  const detailId = url.searchParams.get('detailId');

  if (detailId) {
    const id = Number(detailId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad detailId' }, { status: 400 });
    const [row] = await db.select().from(runHistory)
      .where(eq(runHistory.id, id)).limit(1);
    if (!row || row.jobId !== job.id) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ detail: row });
  }

  const rows = await db.select({
    id: runHistory.id,
    startedAt: runHistory.startedAt, finishedAt: runHistory.finishedAt,
    status: runHistory.status, triggerType: runHistory.triggerType,
    skipReason: runHistory.skipReason, diffMs: runHistory.diffMs,
    paidProjects: runHistory.paidProjects, allProjects: runHistory.allProjects,
    paidQualifications: runHistory.paidQualifications, allQualifications: runHistory.allQualifications,
    newPaidProjects: runHistory.newPaidProjects, newAllProjects: runHistory.newAllProjects,
    newPaidQualifications: runHistory.newPaidQualifications, newAllQualifications: runHistory.newAllQualifications,
    notificationSent: runHistory.notificationSent,
  })
    .from(runHistory).where(eq(runHistory.jobId, job.id))
    .orderBy(desc(runHistory.startedAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  const [{ count }] = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM run_history WHERE job_id = ${job.id}`
  ) as unknown as Array<{ count: number }>;

  return NextResponse.json({ rows, page, pageSize, total: count });
}
```

(The list view omits `extracted_items`/`raw_html`/`error_message`. The detail view (`?detailId=…`) returns the full row.)

- [ ] **Step 3: Commit**

```bash
git add app/api/jobs/[slug]/route.ts app/api/jobs/[slug]/history/
git commit -m "feat(api): GET /api/jobs/[slug] and /history with pagination + detail view"
```

---

## Phase 5 — UI

### Task 17: Dashboard jobs list (replaces old hardcoded list)

**Files:**
- Modify: `app/dashboard/page.tsx`
- Delete (in Task 23): `app/api/status/route.ts`

- [ ] **Step 1: Rewrite the dashboard page as a server component**

```tsx
// app/dashboard/page.tsx
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { verifySessionToken } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { jobRegistry } from '@/lib/jobs/registry';
import Card from '@/components/ui/card';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';

async function latestStatus(jobId: number): Promise<{ status: string; when: Date | null }> {
  const [row] = await db.select({ status: runHistory.status, startedAt: runHistory.startedAt })
    .from(runHistory).where(eq(runHistory.jobId, jobId))
    .orderBy(desc(runHistory.startedAt)).limit(1);
  return { status: row?.status ?? 'idle', when: row?.startedAt ?? null };
}

export default async function DashboardPage() {
  const token = (await cookies()).get('session')?.value;
  if (!token || !(await verifySessionToken(token))) redirect('/');

  const rows = await db.select().from(jobs);
  const data = await Promise.all(rows.map(async j => ({
    job: j,
    inRegistry: jobRegistry.some(m => m.slug === j.slug),
    ...(await latestStatus(j.id)),
  })));

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Auto Checker</h1>
          <form action="/api/auth/logout" method="POST">
            <button className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
          </form>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {data.map(({ job, inRegistry, status, when }) => (
            <Card key={job.id}>
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-lg font-semibold">{job.title}</h2>
                <Badge color={badgeColor(status, inRegistry)}>{inRegistry ? status : 'orphan'}</Badge>
              </div>
              <p className="text-sm text-gray-500 mb-2">{job.description}</p>
              {when && <p className="text-xs text-gray-400 mb-4">Last run: {when.toLocaleString()}</p>}
              <Link href={`/dashboard/jobs/${job.slug}`}>
                <Button className="bg-blue-600 text-white hover:bg-blue-700">Open</Button>
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function badgeColor(status: string, inRegistry: boolean): 'green' | 'red' | 'orange' | 'gray' {
  if (!inRegistry) return 'orange';
  if (status === 'ok') return 'green';
  if (status === 'error') return 'red';
  if (status === 'skipped') return 'gray';
  return 'gray';
}
```

- [ ] **Step 2: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(ui): dashboard lists jobs from DB+registry with derived status"
```

---

### Task 18: Job shell page

**Files:**
- Create: `app/dashboard/jobs/[slug]/page.tsx`

- [ ] **Step 1: Server-side shell composes the sub-components**

```tsx
// app/dashboard/jobs/[slug]/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { verifySessionToken } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { getJob } from '@/lib/jobs/registry';
import { decrypt } from '@/lib/crypto';
import MetaForm from './meta-form';
import ScheduleForm from './schedule-form';
import RecipientsPanel from './recipients-panel';
import HistoryTable from './history-table';
import Countdown from './countdown';
import RunNowButton from './run-now-button';

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = (await cookies()).get('session')?.value;
  if (!token || !(await verifySessionToken(token))) redirect('/');

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return notFound();
  const mod = getJob(slug);

  const custom = (job.customSettings ?? {}) as Record<string, unknown>;
  const customForPanel: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(custom)) {
    if (k.endsWith('_encrypted') && typeof v === 'string') {
      try {
        const plain = decrypt(v);
        const previewKey = k.replace(/_encrypted$/, '_preview');
        customForPanel[previewKey] = plain.length <= 8
          ? '*'.repeat(plain.length)
          : `${plain.slice(0, 4)}…${plain.slice(-4)} (${plain.length} chars)`;
      } catch { /* secret unreadable — leave out */ }
    } else {
      customForPanel[k] = v;
    }
  }

  const Panel = mod?.CustomSettingsPanel;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <a href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</a>

        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{job.title}</h1>
            <p className="text-sm text-gray-500">{job.description}</p>
          </div>
          <div className="text-right space-y-2">
            <Countdown nextRunAt={job.nextRunAt?.toISOString() ?? null} />
            <RunNowButton slug={slug} />
          </div>
        </header>

        <MetaForm slug={slug} initial={{ title: job.title, url: job.url, description: job.description }} />
        <ScheduleForm slug={slug} initial={{
          minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
          dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
          enabled: job.enabled,
        }} />
        {Panel && <Panel jobId={job.id} current={customForPanel} />}
        <RecipientsPanel slug={slug} />
        <HistoryTable slug={slug} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/dashboard/jobs/[slug]/page.tsx
git commit -m "feat(ui): job shell page composes meta/schedule/custom/recipients/history"
```

---

### Task 19: Meta + Schedule + Countdown + RunNow components

**Files:**
- Create: `app/dashboard/jobs/[slug]/meta-form.tsx`
- Create: `app/dashboard/jobs/[slug]/schedule-form.tsx`
- Create: `app/dashboard/jobs/[slug]/countdown.tsx`
- Create: `app/dashboard/jobs/[slug]/run-now-button.tsx`

- [ ] **Step 1: meta-form.tsx**

```tsx
'use client';
import { useState } from 'react';

interface Initial { title: string; url: string; description: string }

export default function MetaForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [meta, setMeta] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meta }),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${res.status}`);
  };

  return (
    <div className="border rounded p-4 space-y-3">
      <h3 className="font-semibold">Job metadata</h3>
      <Field label="Title">
        <input className="w-full border rounded p-2" value={meta.title}
          onChange={e => setMeta({ ...meta, title: e.target.value })} />
      </Field>
      <Field label="URL">
        <input className="w-full border rounded p-2 font-mono text-sm" value={meta.url}
          onChange={e => setMeta({ ...meta, url: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="w-full border rounded p-2" rows={2} value={meta.description}
          onChange={e => setMeta({ ...meta, description: e.target.value })} />
      </Field>
      <button disabled={busy} onClick={save}
        className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm">{msg}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm text-gray-600">{label}</span>{children}</label>;
}
```

- [ ] **Step 2: schedule-form.tsx**

```tsx
'use client';
import { useState } from 'react';

interface Initial {
  minIntervalS: number; maxIntervalS: number;
  dayStartHour: number; dayEndHour: number; tzOffsetH: number;
  enabled: boolean;
}

export default function ScheduleForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: s }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${body.error ?? res.status}`);
  };

  return (
    <div className="border rounded p-4 space-y-3">
      <h3 className="font-semibold">Schedule</h3>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Min interval (sec)" value={s.minIntervalS}
          onChange={v => setS({ ...s, minIntervalS: v })} />
        <NumField label="Max interval (sec)" value={s.maxIntervalS}
          onChange={v => setS({ ...s, maxIntervalS: v })} />
        <NumField label="Active from (local hour 0–23)" value={s.dayStartHour}
          onChange={v => setS({ ...s, dayStartHour: v })} />
        <NumField label="Active to (local hour, exclusive)" value={s.dayEndHour}
          onChange={v => setS({ ...s, dayEndHour: v })} />
        <NumField label="Timezone offset (hours from UTC)" value={s.tzOffsetH}
          onChange={v => setS({ ...s, tzOffsetH: v })} />
        <label className="flex items-end gap-2">
          <input type="checkbox" checked={s.enabled} onChange={e => setS({ ...s, enabled: e.target.checked })} />
          <span className="text-sm">Enabled</span>
        </label>
      </div>
      <button disabled={busy} onClick={save}
        className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm">{msg}</span>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-gray-600">{label}</span>
      <input type="number" className="w-full border rounded p-2"
        value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}
```

- [ ] **Step 3: countdown.tsx**

```tsx
'use client';
import { useEffect, useState } from 'react';

export default function Countdown({ nextRunAt }: { nextRunAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!nextRunAt) return <div className="text-sm text-gray-500">No next run scheduled</div>;
  const remainMs = new Date(nextRunAt).getTime() - now;
  if (remainMs <= 0) return <div className="text-sm text-gray-500">Running soon…</div>;
  const s = Math.floor(remainMs / 1000);
  const mm = Math.floor(s / 60), ss = s % 60;
  return <div className="text-sm text-gray-600">Next run in {mm}m {ss}s</div>;
}
```

- [ ] **Step 4: run-now-button.tsx**

```tsx
'use client';
import { useState } from 'react';

export default function RunNowButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const trigger = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/run`, { method: 'POST' });
    setBusy(false);
    if (res.ok) { setMsg('Run started — refresh history'); return; }
    if (res.status === 409) { setMsg('A run is already in progress'); return; }
    setMsg(`Error: ${res.status}`);
  };

  return (
    <div>
      <button disabled={busy} onClick={trigger}
        className="px-3 py-1.5 rounded bg-green-600 text-white disabled:opacity-50">
        {busy ? 'Running…' : 'Run check now'}
      </button>
      {msg && <div className="text-xs text-gray-500 mt-1">{msg}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/jobs/[slug]/meta-form.tsx app/dashboard/jobs/[slug]/schedule-form.tsx app/dashboard/jobs/[slug]/countdown.tsx app/dashboard/jobs/[slug]/run-now-button.tsx
git commit -m "feat(ui): meta/schedule forms, countdown, run-now button"
```

---

### Task 20: Recipients panel

**Files:**
- Create: `app/dashboard/jobs/[slug]/recipients-panel.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';
import { useEffect, useState } from 'react';

interface Recipient { id: number; name: string; phone: string }

export default function RecipientsPanel({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/jobs/${slug}/recipients`);
    const body = await res.json();
    setRows(body.recipients ?? []);
  };
  useEffect(() => { void load(); }, [slug]);

  const add = async () => {
    if (!name || !phone) return;
    const res = await fetch(`/api/jobs/${slug}/recipients`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    if (res.ok) { setName(''); setPhone(''); void load(); }
    else setMsg(`Add failed: ${res.status}`);
  };

  const update = async (r: Recipient) => {
    const res = await fetch(`/api/jobs/${slug}/recipients/${r.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: r.name, phone: r.phone }),
    });
    setMsg(res.ok ? 'Saved' : `Save failed: ${res.status}`);
    if (res.ok) void load();
  };

  const del = async (id: number) => {
    if (!confirm('Delete this recipient?')) return;
    const res = await fetch(`/api/jobs/${slug}/recipients/${id}`, { method: 'DELETE' });
    if (res.ok) void load();
  };

  const test = async (id: number) => {
    const res = await fetch(`/api/jobs/${slug}/recipients/${id}/test`, { method: 'POST' });
    setMsg(res.ok ? 'Test sent' : `Test failed: ${res.status}`);
  };

  return (
    <div className="border rounded p-4 space-y-3">
      <h3 className="font-semibold">WhatsApp recipients</h3>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id} className="flex gap-2 items-center">
            <input className="border rounded p-1.5 flex-1" value={r.name}
              onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="border rounded p-1.5 flex-1 font-mono text-sm" value={r.phone}
              onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
            <button onClick={() => update(r)} className="px-2 py-1 rounded bg-blue-600 text-white text-sm">Save</button>
            <button onClick={() => test(r.id)} className="px-2 py-1 rounded bg-gray-600 text-white text-sm">Test</button>
            <button onClick={() => del(r.id)}  className="px-2 py-1 rounded bg-red-600  text-white text-sm">Delete</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t pt-3">
        <input placeholder="Name"  value={name}  onChange={e => setName(e.target.value)}
          className="border rounded p-1.5 flex-1" />
        <input placeholder="Phone (E.164)" value={phone} onChange={e => setPhone(e.target.value)}
          className="border rounded p-1.5 flex-1 font-mono text-sm" />
        <button onClick={add} className="px-3 py-1.5 rounded bg-green-600 text-white text-sm">Add</button>
      </div>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/dashboard/jobs/[slug]/recipients-panel.tsx
git commit -m "feat(ui): per-job WhatsApp recipients panel with edit/delete/test"
```

---

### Task 21: History table with show-detail expander

**Files:**
- Create: `app/dashboard/jobs/[slug]/history-table.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';
import { useEffect, useState } from 'react';

interface Row {
  id: number;
  startedAt: string; finishedAt: string;
  status: string; triggerType: string; skipReason: string | null; diffMs: number | null;
  paidProjects: number; allProjects: number;
  paidQualifications: number; allQualifications: number;
  newPaidProjects: number; newAllProjects: number;
  newPaidQualifications: number; newAllQualifications: number;
  notificationSent: boolean;
}

interface Detail extends Row {
  extractedItems: unknown[] | null;
  rawHtml: string | null;
  errorMessage: string | null;
}

export default function HistoryTable({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [open, setOpen] = useState<Record<number, Detail | 'loading' | undefined>>({});

  const load = async (p: number) => {
    const res = await fetch(`/api/jobs/${slug}/history?page=${p}&pageSize=${pageSize}`);
    const body = await res.json();
    setRows(body.rows ?? []); setTotal(body.total ?? 0);
  };
  useEffect(() => { void load(page); }, [slug, page]);

  const toggle = async (id: number) => {
    if (open[id]) { setOpen({ ...open, [id]: undefined }); return; }
    setOpen({ ...open, [id]: 'loading' });
    const res = await fetch(`/api/jobs/${slug}/history?detailId=${id}`);
    const body = await res.json();
    setOpen({ ...open, [id]: body.detail });
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Run history ({total})</h3>
        <div className="text-sm">
          <button disabled={page <= 1}      onClick={() => setPage(p => p - 1)} className="px-2 disabled:opacity-30">‹</button>
          <span>Page {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2 disabled:opacity-30">›</button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th>When</th><th>Status</th><th>Trigger</th>
            <th>Projects (paid/all)</th><th>Quals (paid/all)</th>
            <th>New Proj (paid/all)</th><th>New Quals (paid/all)</th>
            <th>Δ</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <>
              <tr key={r.id} className="border-t">
                <td>{new Date(r.startedAt).toLocaleString()}</td>
                <td>
                  <span className={statusClass(r.status)}>{r.status}</span>
                  {r.skipReason && <span className="text-xs text-gray-500"> ({r.skipReason})</span>}
                </td>
                <td>{r.triggerType}</td>
                <td>{r.paidProjects}/{r.allProjects}</td>
                <td>{r.paidQualifications}/{r.allQualifications}</td>
                <td>{r.newPaidProjects}/{r.newAllProjects}</td>
                <td>{r.newPaidQualifications}/{r.newAllQualifications}</td>
                <td>{r.diffMs != null ? `${Math.round(r.diffMs / 1000)}s` : '—'}</td>
                <td><button onClick={() => toggle(r.id)} className="text-blue-600 text-xs">
                  {open[r.id] ? 'hide' : 'detail'}
                </button></td>
              </tr>
              {open[r.id] === 'loading' && (
                <tr><td colSpan={9} className="text-xs text-gray-500 p-2">Loading…</td></tr>
              )}
              {open[r.id] && open[r.id] !== 'loading' && (
                <tr><td colSpan={9} className="bg-gray-50 p-2">
                  <DetailView detail={open[r.id] as Detail} />
                </td></tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusClass(s: string): string {
  if (s === 'ok')      return 'text-green-700';
  if (s === 'error')   return 'text-red-700';
  if (s === 'skipped') return 'text-gray-500';
  return '';
}

function DetailView({ detail }: { detail: Detail }) {
  return (
    <div className="space-y-2 text-xs">
      {detail.errorMessage && <div className="text-red-700">Error: {detail.errorMessage}</div>}
      {detail.extractedItems && (
        <details>
          <summary className="cursor-pointer">Extracted items ({(detail.extractedItems as unknown[]).length})</summary>
          <pre className="overflow-auto max-h-80">{JSON.stringify(detail.extractedItems, null, 2)}</pre>
        </details>
      )}
      {detail.rawHtml && (
        <details>
          <summary className="cursor-pointer">Raw HTML ({detail.rawHtml.length} chars)</summary>
          <pre className="overflow-auto max-h-80 font-mono">{detail.rawHtml.slice(0, 5000)}</pre>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/dashboard/jobs/[slug]/history-table.tsx
git commit -m "feat(ui): paginated history table with show-detail expander"
```

---

## Phase 6 — Deployment and Cleanup

### Task 22: Dockerfile, entrypoint, env example

**Files:**
- Create: `Dockerfile`
- Create: `docker-entrypoint.sh`
- Create: `.env.example`
- Modify: `next.config.ts` (add `output: 'standalone'`)
- Modify: `package.json` (add a `migrate` script)

- [ ] **Step 1: Verify `next.config.ts`**

If `next.config.ts` lacks `output: 'standalone'`, add it:
```ts
import type { NextConfig } from 'next';
const config: NextConfig = { output: 'standalone' };
export default config;
```

(If the file uses `.js` or has other config, just add the property.)

- [ ] **Step 2: Add a `migrate` npm script**

In `package.json` scripts:
```jsonc
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest",
  "migrate": "tsx scripts/migrate.ts"
}
```

Add `tsx` to devDependencies:
```jsonc
"tsx": "^4.19.0"
```

Run: `npm install`

- [ ] **Step 3: Create the migrate runner script**

```ts
// scripts/migrate.ts
import { runMigrations } from '../lib/db/migrate';
runMigrations()
  .then(() => { console.log('migrations done'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: docker-entrypoint.sh**

```bash
#!/bin/sh
set -e
echo "[entrypoint] running migrations..."
node lib/db/migrate-run.js
echo "[entrypoint] starting server..."
exec node server.js
```

But we need a compiled version of the migrate runner — let's instead build it during Docker stage by compiling `scripts/migrate.ts` to JS, or use a different approach: install `tsx` in the runtime layer (small).

Simpler approach — install `tsx` + the migration files in the runtime image and call it from the entrypoint:

```bash
#!/bin/sh
set -e
echo "[entrypoint] running migrations..."
node --import tsx scripts/migrate.ts
echo "[entrypoint] starting server..."
exec node server.js
```

- [ ] **Step 5: Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.7

# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Standalone server
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Migration assets + a minimal runtime to invoke them
COPY --from=build /app/lib/db ./lib/db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build /app/node_modules/pg ./node_modules/pg

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 6: .env.example**

```bash
# --- App ---
JWT_SECRET=                    # 32+ random chars; openssl rand -hex 32
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=           # bcrypt hash of admin password
ENCRYPTION_KEY=                # 32 bytes hex (64 chars); openssl rand -hex 32

# --- Database (Northflank-provided) ---
DATABASE_URL=postgres://user:pass@host:5432/dbname

# --- WAHA (your existing Northflank service) ---
WAHA_URL=https://your-waha.northflank.app
WAHA_API_KEY=

# --- App runtime ---
PORT=3000
NODE_ENV=production
```

- [ ] **Step 7: Build the image locally to validate**

Run: `docker build -t auto-checker .`
Expected: succeeds. (Does not start the app — startup needs `DATABASE_URL`.)

- [ ] **Step 8: Commit**

```bash
git add Dockerfile docker-entrypoint.sh .env.example next.config.ts package.json package-lock.json scripts/migrate.ts
git commit -m "feat(docker): production Dockerfile, entrypoint runs migrations"
```

---

### Task 23: Delete dead code

**Files to delete:**
- `app/api/cron/` (entire directory — external cron no longer used)
- `app/api/status/route.ts` (dashboard derives status from DB)
- `app/api/settings/` (entire directory — replaced by `/api/jobs/[slug]/settings`)
- `app/dashboard/data-annotation/` (entire directory — replaced by `/dashboard/jobs/data-annotation`)
- `app/dashboard/settings/` (no global settings page in v1; if you want one later, add then)
- `lib/kv.ts` (Upstash gone)
- `lib/checkers/` (entire directory — moved to `lib/jobs/data-annotation`)
- `components/global-settings-form.tsx` (if it exists and is only referenced by deleted `app/dashboard/settings/page.tsx`)

- [ ] **Step 1: Identify any remaining references**

Run grep to confirm nothing is left referencing the old paths:
```bash
grep -rn "lib/checkers" app/ lib/ components/ 2>/dev/null
grep -rn "lib/kv" app/ lib/ components/ 2>/dev/null
grep -rn "api/status" app/ components/ 2>/dev/null
grep -rn "api/cron" app/ components/ 2>/dev/null
```

If anything turns up, fix the references first (likely none should — we replaced all consumers).

- [ ] **Step 2: Delete the files**

```bash
git rm -rf app/api/cron app/api/status app/api/settings app/dashboard/data-annotation app/dashboard/settings lib/kv.ts lib/checkers
git rm -f components/global-settings-form.tsx 2>/dev/null || true
```

- [ ] **Step 3: Build verification**

Run: `npm run build`
Expected: build succeeds. If TypeScript surfaces references to deleted files, fix them. (Common culprits: leftover imports in deleted-but-not-removed files; the `git rm` should prevent that.)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete dead Upstash/external-cron code paths"
```

---

### Task 24: End-to-end smoke test in dev

This task has no code — it's a manual verification gate before declaring v1 done. Spec §9 says we don't write E2E tests; we run through the flows once manually.

- [ ] **Step 1: Prepare local env**

Have a local or remote Postgres available, plus a reachable WAHA instance. Copy `.env.example` → `.env.local`, fill it in. Generate the password hash once:
```bash
node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"
```

- [ ] **Step 2: Run dev**

```bash
npm run migrate
npm run dev
```

Expected: migrations apply cleanly, dev server starts, console logs the scheduler boot (you'll need a `console.log('[scheduler] started')` line in `start()` if you want this visible — optional).

- [ ] **Step 3: Walk the flows**

In the browser:
1. Log in with `ADMIN_USERNAME` / your password.
2. Dashboard shows DataAnnotation card.
3. Open the job page. Confirm: meta-form prefilled, schedule-form prefilled with defaults, DA settings panel visible, recipients empty, history empty, countdown showing.
4. Paste a real cookie, click Save. Reload — preview shows masked first/last 4 chars.
5. Add a recipient with your phone, click Test — confirm WhatsApp receives.
6. Click Run check now — confirm 200 response; reload; history table shows a new `ok` row (or `error` if cookie is bad).
7. Click Run again immediately — expect 409 (lock_busy) if the first run is still in flight, else another run.
8. Edit the schedule to min=60, max=60 (1-min interval) and save. Within ~1 min, watch a new scheduled row appear in history.
9. Restore sensible intervals and save.

- [ ] **Step 4: Build and run via Docker locally**

```bash
docker build -t auto-checker .
docker run --env-file .env.local -p 3000:3000 auto-checker
```

Expected: container boots, migrations run (idempotent — second run is a no-op), app serves at :3000. Walk one flow to confirm.

- [ ] **Step 5: Commit any fixes**

If anything broke during walking and you fixed it, commit the fix with a clear `fix:` message. Otherwise no commit.

---

## Self-Review Notes (inline, for the executor)

- **Spec coverage check** — every spec requirement is covered:
  - Multi-job dashboard ✓ Task 17
  - Per-job editable meta/schedule ✓ Tasks 14, 18, 19
  - Recipients per-job ✓ Tasks 15, 20
  - Cookie front/back masked ✓ Tasks 10, 16, 18
  - In-process scheduler with jitter + active window ✓ Tasks 6, 8
  - Next-run timestamp drives countdown ✓ Tasks 8, 19
  - "Absent in last successful run = new" ✓ Task 11
  - Notification: `newPaidProjects > 0 || newAllQualifications > 0` ✓ Task 10
  - 3-strikes alert ✓ Task 8 (`maybeAlertFailureStreak`)
  - Single Dockerfile ✓ Task 22
  - Postgres + Drizzle, advisory locks, no Redis ✓ Tasks 1, 2, 7, 8
  - Bcrypt admin password ✓ Task 4
  - AES-256-GCM cookie encryption ✓ Task 3, integrated in 10 and 14
  - Run history retained forever ✓ schema in Task 2, no retention job
  - Raw HTML stored only on error ✓ Task 8 (insert), Task 10 (sets it on errors)
  - Manual run bypasses window + returns 409 on lock ✓ Tasks 8, 13
- **Type consistency check** — `RunResult` shape consistent across Tasks 5, 8, 10. Schema column names consistent across Tasks 2 and all queries. `JobModule.CustomSettingsPanel` matches the prop shape used in Tasks 10 and 18.
