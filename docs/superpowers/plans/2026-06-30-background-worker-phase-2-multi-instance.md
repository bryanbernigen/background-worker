# Background Worker — Phase 2: Multi-instance + Schedule Types + Create API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin run many configured instances of a job *type*, each on its own schedule (`window` | `interval` | `cron`), created through an HTTP API; turn the registry into a type catalog (no auto-seed).

**Architecture:** Add `scheduleType`/`intervalS`/`cronExpr` to `jobs` (migration `0003`). Generalize the pure schedule engine (`lib/scheduler/window.ts`) to branch per type, using `croner` for cron (fed UTC, offset applied by us). Isolate create-instance logic into a pure, DB-free builder (`lib/jobs/create-job.ts` + `lib/jobs/slug.ts`) that the thin `POST /api/jobs` route calls; add `DELETE /api/jobs/[slug]` and extend the settings PATCH for schedule types. Remove auto-seeding; expose `GET /api/jobs/types`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Drizzle ORM + PostgreSQL, Vitest, `croner` (new), Zod, WAHA. Read `node_modules/next/dist/docs/` before touching Next-specific code per `AGENTS.md`.

**Spec:** `docs/superpowers/specs/2026-06-30-background-worker-phase-2-design.md`.

## Global Constraints

- Next.js is a modified build — APIs may differ from training data. Read the relevant guide under `node_modules/next/dist/docs/` before writing Next code (`AGENTS.md`).
- Migrations run automatically on boot via `instrumentation.ts → runMigrations`; the migrator (`lib/db/migrate.ts`) applies `lib/db/migrations/*.sql` in `meta/_journal.json` order. `drizzle-kit generate`'s rename TUI can't be driven non-interactively — hand-author the migration sql + `meta/<n>_snapshot.json` + journal entry, then validate by running `npx drizzle-kit generate` and confirming **"No schema changes, nothing to migrate"**.
- **Migrate env caveat:** `npm run migrate` runs under `tsx`, which does NOT auto-load `.env*`; `.env` holds a remote GCP `DATABASE_URL` that shadows the local Docker one in `.env.local`. Apply with `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts` (`.env.local` LAST so it wins). The local DB is the Docker `postgres:18-trixie` on `localhost:5432`.
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. Run tests with `npx vitest run <path>` (Vitest resolves `@/` to repo root via `vitest.config.ts`).
- Auth/roles unchanged — all routes use the existing `requireSession` gate (roles/guest are Phase 3).
- DataAnnotation must keep behaving exactly as today (one `window` instance). End of phase: full suite + `tsc --noEmit` + `npm run build` all green.
- Frequent commits: one per task minimum. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Schema + migration `0003_schedule_types`

Add `scheduleType`, `intervalS`, `cronExpr` to `jobs`. Existing rows adopt `scheduleType='window'` via the default; no other data change.

**Files:**
- Modify: `lib/db/schema.ts` (the `jobs` table)
- Create: `lib/db/migrations/0003_schedule_types.sql`, `lib/db/migrations/meta/0003_snapshot.json`
- Modify: `lib/db/migrations/meta/_journal.json`

**Interfaces:**
- Produces (Drizzle inferred): `Job` now has `scheduleType: string`, `intervalS: number | null`, `cronExpr: string | null`.

- [ ] **Step 1: Edit `lib/db/schema.ts`**

In the `jobs` table, immediately after the `enabled` line, add:

```ts
  scheduleType:   text('schedule_type').notNull().default('window'),
  intervalS:      integer('interval_s'),
  cronExpr:       text('cron_expr'),
```

(Leave `minIntervalS`/`maxIntervalS`/`dayStartHour`/`dayEndHour`/`tzOffsetH` as-is — they drive the `window` type.)

- [ ] **Step 2: Write the migration sql**

Create `lib/db/migrations/0003_schedule_types.sql` with exactly:

```sql
ALTER TABLE "jobs" ADD COLUMN "schedule_type" text DEFAULT 'window' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "interval_s" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cron_expr" text;
```

- [ ] **Step 3: Hand-author the snapshot + journal**

Copy `lib/db/migrations/meta/0002_snapshot.json` to `meta/0003_snapshot.json`. In the copy:
- Set `"id"` to a fresh UUID (run `node -e "console.log(require('crypto').randomUUID())"`).
- Set `"prevId"` to the **`id` value from `0002_snapshot.json`** (`f810e99a-fa73-4cb7-886c-5ac9fc1831cd`).
- In `tables."public.jobs".columns`, after the `"enabled"` entry, add:

```json
        "schedule_type": {
          "name": "schedule_type",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "'window'"
        },
        "interval_s": {
          "name": "interval_s",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "cron_expr": {
          "name": "cron_expr",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
```

Append to `meta/_journal.json` `entries` (after idx 2):

```json
    {
      "idx": 3,
      "version": "7",
      "when": 1782825600000,
      "tag": "0003_schedule_types",
      "breakpoints": true
    }
```

- [ ] **Step 4: Validate the snapshot matches the schema**

Run: `npx drizzle-kit generate`
Expected: prints the table summary and **"No schema changes, nothing to migrate 😴"** (proves `0003_snapshot.json` exactly matches `schema.ts`). If it instead prompts or generates a `0004`, the snapshot is wrong — fix it and re-run. (If it leaves a stray `0004*` file, delete it.)

- [ ] **Step 5: Apply + verify against the Docker DB**

Run: `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts`
Expected: `migrations done`.

Verify the columns exist (write a throwaway script `__verify.mjs` in the repo root, run it, then delete it):

```js
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(
  `select column_name, data_type, is_nullable, column_default from information_schema.columns
   where table_name='jobs' and column_name in ('schedule_type','interval_s','cron_expr') order by column_name`);
console.table(rows);
await c.end();
```

Run: `node --env-file=.env --env-file=.env.local __verify.mjs` then `rm __verify.mjs`
Expected: `schedule_type` (text, NOT NULL, default `'window'`), `interval_s` (integer, nullable), `cron_expr` (text, nullable). (The script must be in the repo root so it resolves the `pg` dependency.)

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0003_schedule_types.sql lib/db/migrations/meta/0003_snapshot.json lib/db/migrations/meta/_journal.json
git commit -m "feat(db): add jobs.scheduleType/intervalS/cronExpr (migration 0003)"
```

---

### Task 2: Schedule engine — `interval` + `cron` branches

Install `croner`; generalize `lib/scheduler/window.ts` so `computeNextRunAt` / `isWithinWindow` branch on a discriminated `ScheduleCfg`, and add `validateSchedule`.

**Files:**
- Modify: `lib/scheduler/window.ts`
- Modify: `lib/scheduler/window.test.ts`
- Modify: `package.json` (adds `croner`)

**Interfaces:**
- Consumes: `croner`'s `Cron` (`import { Cron } from 'croner'`).
- Produces:
  - `type ScheduleType = 'window' | 'interval' | 'cron'`
  - `interface ScheduleCfg { scheduleType: ScheduleType; minIntervalS: number; maxIntervalS: number; dayStartHour: number; dayEndHour: number; tzOffsetH: number; intervalS: number | null; cronExpr: string | null }`
  - `computeNextRunAt(now: Date, cfg: ScheduleCfg): Date` (window branch unchanged)
  - `isWithinWindow(now: Date, cfg: ScheduleCfg): boolean` (`true` for interval/cron)
  - `cronNextRun(now: Date, cronExpr: string, tzOffsetH: number): Date`
  - `validateSchedule(cfg: ScheduleCfg): void` (throws `Error` on invalid params)

- [ ] **Step 1: Install croner**

Run: `npm install croner@^9`
Expected: adds `croner` to `dependencies`. Verify: `node -e "console.log(require('croner/package.json').version)"` prints a `9.x` version.

- [ ] **Step 2: Write the failing tests**

Add to `lib/scheduler/window.test.ts` (keep existing tests):

```ts
import { describe, it, expect } from 'vitest';
import { computeNextRunAt, isWithinWindow, cronNextRun, validateSchedule, type ScheduleCfg } from './window';

const base: ScheduleCfg = {
  scheduleType: 'window',
  minIntervalS: 600, maxIntervalS: 1800,
  dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7,
  intervalS: null, cronExpr: null,
};

describe('interval schedule', () => {
  it('computeNextRunAt = now + intervalS', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const next = computeNextRunAt(now, { ...base, scheduleType: 'interval', intervalS: 300 });
    expect(next.getTime()).toBe(now.getTime() + 300_000);
  });
  it('isWithinWindow is always true for interval', () => {
    expect(isWithinWindow(new Date('2026-07-01T20:00:00Z'), { ...base, scheduleType: 'interval', intervalS: 300 })).toBe(true);
  });
});

describe('cron schedule (offset model)', () => {
  it('fires daily at 09:00 in the job offset (tz+7 → 02:00 UTC)', () => {
    // now = 2026-07-01 00:00 UTC == 07:00 local(+7); next 09:00 local == 02:00 UTC same day
    const next = cronNextRun(new Date('2026-07-01T00:00:00Z'), '0 9 * * *', 7);
    expect(next.toISOString()).toBe('2026-07-01T02:00:00.000Z');
  });
  it('computeNextRunAt routes cron through cronNextRun', () => {
    const next = computeNextRunAt(new Date('2026-07-01T00:00:00Z'), { ...base, scheduleType: 'cron', cronExpr: '0 9 * * *' });
    expect(next.toISOString()).toBe('2026-07-01T02:00:00.000Z');
  });
  it('isWithinWindow is always true for cron', () => {
    expect(isWithinWindow(new Date('2026-07-01T03:00:00Z'), { ...base, scheduleType: 'cron', cronExpr: '0 9 * * *' })).toBe(true);
  });
});

describe('validateSchedule', () => {
  it('accepts a valid window/interval/cron', () => {
    expect(() => validateSchedule(base)).not.toThrow();
    expect(() => validateSchedule({ ...base, scheduleType: 'interval', intervalS: 300 })).not.toThrow();
    expect(() => validateSchedule({ ...base, scheduleType: 'cron', cronExpr: '*/15 * * * *' })).not.toThrow();
  });
  it('rejects interval without a positive intervalS', () => {
    expect(() => validateSchedule({ ...base, scheduleType: 'interval', intervalS: null })).toThrow();
    expect(() => validateSchedule({ ...base, scheduleType: 'interval', intervalS: 0 })).toThrow();
  });
  it('rejects cron with no/invalid expression', () => {
    expect(() => validateSchedule({ ...base, scheduleType: 'cron', cronExpr: null })).toThrow();
    expect(() => validateSchedule({ ...base, scheduleType: 'cron', cronExpr: 'not a cron' })).toThrow();
  });
  it('rejects window with min > max', () => {
    expect(() => validateSchedule({ ...base, minIntervalS: 2000, maxIntervalS: 1000 })).toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/scheduler/window.test.ts`
Expected: FAIL — `cronNextRun`/`validateSchedule`/`ScheduleCfg` not exported; `computeNextRunAt`/`isWithinWindow` don't accept the new cfg.

- [ ] **Step 4: Implement the generalization in `lib/scheduler/window.ts`**

Add at the top:

```ts
import { Cron } from 'croner';
```

Keep `Window`, `JitterCfg`, `localHour`, `nextWindowOpening`, `jitter`, `jitteredWindowOpening` as-is. Add the cfg type and replace `isWithinWindow` / `computeNextRunAt`, and add `cronNextRun` + `validateSchedule`:

```ts
export type ScheduleType = 'window' | 'interval' | 'cron';

export interface ScheduleCfg {
  scheduleType: ScheduleType;
  minIntervalS: number;
  maxIntervalS: number;
  dayStartHour: number;
  dayEndHour:   number;
  tzOffsetH:    number;
  intervalS:    number | null;
  cronExpr:     string | null;
}

/** Next cron fire in the job's integer-offset wall clock. We treat the
 *  expression as UTC wall-clock (`timezone:'UTC'`) on an offset-shifted clock,
 *  then shift the result back to real UTC. */
export function cronNextRun(now: Date, cronExpr: string, tzOffsetH: number): Date {
  const shift = tzOffsetH * 3600 * 1000;
  const cron = new Cron(cronExpr, { timezone: 'UTC' });
  const next = cron.nextRun(new Date(now.getTime() + shift));
  if (!next) throw new Error(`cron expression has no next run: ${cronExpr}`);
  return new Date(next.getTime() - shift);
}

export function isWithinWindow(now: Date, cfg: ScheduleCfg | Window): boolean {
  if ('scheduleType' in cfg && cfg.scheduleType !== 'window') return true;
  const h = localHour(now, cfg.tzOffsetH);
  return h >= cfg.dayStartHour && h < cfg.dayEndHour;
}

export function computeNextRunAt(now: Date, cfg: ScheduleCfg): Date {
  if (cfg.scheduleType === 'interval') {
    if (!cfg.intervalS || cfg.intervalS <= 0) throw new Error('interval schedule needs a positive intervalS');
    return new Date(now.getTime() + cfg.intervalS * 1000);
  }
  if (cfg.scheduleType === 'cron') {
    if (!cfg.cronExpr) throw new Error('cron schedule needs a cronExpr');
    return cronNextRun(now, cfg.cronExpr, cfg.tzOffsetH);
  }
  // window (unchanged behaviour)
  if (!isWithinWindow(now, cfg)) return jitteredWindowOpening(now, cfg);
  const raw = new Date(now.getTime() + jitter(cfg.minIntervalS, cfg.maxIntervalS) * 1000);
  if (!isWithinWindow(raw, cfg)) return jitteredWindowOpening(raw, cfg);
  return raw;
}

export function validateSchedule(cfg: ScheduleCfg): void {
  if (cfg.scheduleType === 'interval') {
    if (!cfg.intervalS || cfg.intervalS <= 0) throw new Error('interval schedule needs a positive intervalS');
    return;
  }
  if (cfg.scheduleType === 'cron') {
    if (!cfg.cronExpr) throw new Error('cron schedule needs a cronExpr');
    try { new Cron(cfg.cronExpr); } catch { throw new Error(`invalid cron expression: ${cfg.cronExpr}`); }
    if (!new Cron(cfg.cronExpr).nextRun()) throw new Error(`cron expression never fires: ${cfg.cronExpr}`);
    return;
  }
  if (cfg.minIntervalS > cfg.maxIntervalS) throw new Error('minIntervalS > maxIntervalS');
  if (cfg.dayStartHour >= cfg.dayEndHour) throw new Error('dayStartHour >= dayEndHour');
}
```

> Note: `jitteredWindowOpening`/`nextWindowOpening` take `Window & JitterCfg`; `ScheduleCfg` is structurally compatible (has all those fields), so passing `cfg` works.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/scheduler/window.test.ts`
Expected: PASS (existing window tests + the new interval/cron/validate tests). `computeNextRunAt`/`isWithinWindow` callers in `lib/scheduler/index.ts` may show a type error until Task 3 — that's expected; do not run a full build here.

- [ ] **Step 6: Commit**

```bash
git add lib/scheduler/window.ts lib/scheduler/window.test.ts package.json package-lock.json
git commit -m "feat(scheduler): interval + cron schedule branches (croner), validateSchedule"
```

---

### Task 3: Scheduler wiring — `jobCfg` carries scheduleType + `unschedule`

Feed the new columns into the engine and add a public `unschedule(jobId)` for instance deletion.

**Files:**
- Modify: `lib/scheduler/index.ts`
- Test: `lib/scheduler/unschedule.test.ts` (new)

**Interfaces:**
- Consumes: `ScheduleCfg` (Task 2), `jobs.scheduleType/intervalS/cronExpr` (Task 1).
- Produces: `unschedule(jobId: number): void` (clears both the run timer and the expiry timer for a job).

- [ ] **Step 1: Update `jobCfg` to return a `ScheduleCfg`**

In `lib/scheduler/index.ts`, replace the `jobCfg` function with:

```ts
function jobCfg(job: Job): ScheduleCfg {
  return {
    scheduleType: job.scheduleType as ScheduleCfg['scheduleType'],
    dayStartHour: job.dayStartHour,
    dayEndHour:   job.dayEndHour,
    tzOffsetH:    job.tzOffsetH,
    minIntervalS: job.minIntervalS,
    maxIntervalS: job.maxIntervalS,
    intervalS:    job.intervalS,
    cronExpr:     job.cronExpr,
  };
}
```

Add `ScheduleCfg` to the `window` import at the top:

```ts
import { computeNextRunAt, isWithinWindow, type ScheduleCfg } from './window';
```

- [ ] **Step 2: Add the `unschedule` export**

Add near `reschedule` in `lib/scheduler/index.ts`:

```ts
/** Clear a job's run + expiry timers (e.g. when the instance is deleted). */
export function unschedule(jobId: number): void {
  const t = timers.get(jobId);
  if (t) { clearTimeout(t); timers.delete(jobId); }
  const e = expiryTimers.get(jobId);
  if (e) { clearTimeout(e); expiryTimers.delete(jobId); }
}
```

- [ ] **Step 3: Write the failing test**

Create `lib/scheduler/unschedule.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unschedule } from './index';

describe('unschedule', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears a job run timer so its callback never fires', () => {
    const fired = vi.fn();
    const timers: Map<number, NodeJS.Timeout> = (globalThis as Record<string, unknown>).__schedulerTimers as Map<number, NodeJS.Timeout>;
    timers.set(42, setTimeout(fired, 1000));
    unschedule(42);
    vi.advanceTimersByTime(5000);
    expect(fired).not.toHaveBeenCalled();
    expect(timers.has(42)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails, then passes**

Run: `npx vitest run lib/scheduler/unschedule.test.ts`
Expected: FAIL first only if `unschedule` is missing — since Steps 1–2 already added it, this test should PASS now. (The `__schedulerTimers` global is created at module load in `index.ts`.) If it fails because the global is undefined, the import side-effect didn't run — confirm `import { unschedule } from './index'` resolves.

- [ ] **Step 5: Verify scheduler typechecks**

Run: `npx tsc --noEmit 2>&1 | grep -i "lib/scheduler" || echo "scheduler clean"`
Expected: `scheduler clean` (the `computeNextRunAt`/`isWithinWindow` calls now line up with `ScheduleCfg`).

- [ ] **Step 6: Commit**

```bash
git add lib/scheduler/index.ts lib/scheduler/unschedule.test.ts
git commit -m "feat(scheduler): jobCfg carries scheduleType; add unschedule(jobId)"
```

---

### Task 4: Registry catalog + remove auto-seed + `GET /api/jobs/types`

The registry becomes a catalog; boot no longer auto-creates instances; expose the catalog over HTTP.

**Files:**
- Modify: `lib/jobs/registry.ts`
- Delete: `lib/jobs/seed.ts`
- Modify: `instrumentation.ts`
- Create: `app/api/jobs/types/route.ts`
- Modify: `lib/jobs/registry.test.ts`

**Interfaces:**
- Produces: `listJobTypes(): { type: string; defaultMeta: JobModule['defaultMeta']; hasSettingsPanel: boolean }[]`

- [ ] **Step 1: Write the failing test**

Add to `lib/jobs/registry.test.ts`:

```ts
import { listJobTypes } from './registry';

describe('listJobTypes', () => {
  it('returns the data-annotation type with its meta', () => {
    const types = listJobTypes();
    const da = types.find(t => t.type === 'data-annotation');
    expect(da).toBeDefined();
    expect(da!.defaultMeta.title).toBe('Data Annotation');
    expect(typeof da!.hasSettingsPanel).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/jobs/registry.test.ts`
Expected: FAIL — `listJobTypes` not exported.

- [ ] **Step 3: Add `listJobTypes` to `lib/jobs/registry.ts`**

```ts
export function listJobTypes(): { type: string; defaultMeta: JobModule['defaultMeta']; hasSettingsPanel: boolean }[] {
  return jobRegistry.map(m => ({
    type: m.type,
    defaultMeta: m.defaultMeta,
    hasSettingsPanel: !!m.CustomSettingsPanel,
  }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/jobs/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove auto-seeding**

Delete the seed module: `git rm lib/jobs/seed.ts`

Edit `instrumentation.ts` — remove the seed import and call:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runMigrations } = await import('./lib/db/migrate');
  const { start } = await import('./lib/scheduler');

  await runMigrations();
  await start();
}
```

- [ ] **Step 6: Create `app/api/jobs/types/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/api/require-session';
import { listJobTypes } from '@/lib/jobs/registry';

export async function GET() {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  return NextResponse.json({ types: listJobTypes() });
}
```

- [ ] **Step 7: Verify + commit**

Run: `npx vitest run lib/jobs/registry.test.ts && npx tsc --noEmit 2>&1 | grep -iE "seed|instrumentation|jobs/types" || echo clean`
Expected: tests PASS; `clean` (no dangling references to `seedRegistryJobs`).

```bash
git add lib/jobs/registry.ts instrumentation.ts app/api/jobs/types/route.ts lib/jobs/registry.test.ts
git rm lib/jobs/seed.ts
git commit -m "refactor(jobs): registry is a type catalog; drop auto-seed; add GET /api/jobs/types"
```

---

### Task 5: Create-instance pure core — slug helpers + payload builder

DB-free logic the route calls: slug derivation, payload schema, and a builder that maps a validated payload into `jobs`/`recipients` insert values (validating type, schedule, and custom settings).

**Files:**
- Create: `lib/jobs/slug.ts`, `lib/jobs/slug.test.ts`
- Create: `lib/jobs/create-job.ts`, `lib/jobs/create-job.test.ts`

**Interfaces:**
- Consumes: `validateSchedule` (Task 2), `getJob` (registry), `jobs` insert type (`typeof jobs.$inferInsert`), `JobModule`.
- Produces:
  - `slugify(name: string): string`
  - `nextAvailableSlug(base: string, existing: string[]): string`
  - `createJobSchema` (Zod) and `type CreateJobPayload = z.infer<typeof createJobSchema>`
  - `class CreateJobError extends Error { status: number }`
  - `buildJobInsert(payload: CreateJobPayload, mod: JobModule, existingSlugs: string[]): { job: typeof jobs.$inferInsert; recipients: { name: string; phone: string; tag: string | null }[] }`

- [ ] **Step 1: Write the failing slug tests**

Create `lib/jobs/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify, nextAvailableSlug } from './slug';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Data Annotation Main!')).toBe('data-annotation-main');
  });
  it('trims leading/trailing dashes and falls back to "job"', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
    expect(slugify('!!!')).toBe('job');
  });
});

describe('nextAvailableSlug', () => {
  it('returns base when free', () => {
    expect(nextAvailableSlug('da', ['x', 'y'])).toBe('da');
  });
  it('suffixes -2, -3 on collision', () => {
    expect(nextAvailableSlug('da', ['da'])).toBe('da-2');
    expect(nextAvailableSlug('da', ['da', 'da-2'])).toBe('da-3');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/jobs/slug.test.ts`
Expected: FAIL — `./slug` does not exist.

- [ ] **Step 3: Implement `lib/jobs/slug.ts`**

```ts
export function slugify(name: string): string {
  const s = name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'job';
}

export function nextAvailableSlug(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/jobs/slug.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing builder tests**

Create `lib/jobs/create-job.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createJobSchema, buildJobInsert, CreateJobError } from './create-job';
import { dataAnnotation } from './data-annotation';

const da = dataAnnotation;

function payload(over: Record<string, unknown> = {}) {
  return createJobSchema.parse({
    type: 'data-annotation',
    name: 'DA Main',
    schedule: { type: 'interval', intervalS: 300 },
    ...over,
  });
}

describe('buildJobInsert', () => {
  it('maps an interval schedule + derives slug + title from name', () => {
    const { job, recipients } = buildJobInsert(payload(), da, []);
    expect(job.type).toBe('data-annotation');
    expect(job.slug).toBe('da-main');
    expect(job.title).toBe('DA Main');
    expect(job.url).toBe(da.defaultMeta.url);
    expect(job.scheduleType).toBe('interval');
    expect(job.intervalS).toBe(300);
    expect(job.cronExpr).toBeNull();
    expect(job.enabled).toBe(true);
    expect(recipients).toEqual([]);
  });

  it('suffixes the slug on collision', () => {
    const { job } = buildJobInsert(payload(), da, ['da-main']);
    expect(job.slug).toBe('da-main-2');
  });

  it('honors an explicit slug and 409s when taken', () => {
    expect(buildJobInsert(payload({ slug: 'custom' }), da, []).job.slug).toBe('custom');
    expect(() => buildJobInsert(payload({ slug: 'custom' }), da, ['custom'])).toThrow(CreateJobError);
  });

  it('maps a cron schedule', () => {
    const { job } = buildJobInsert(payload({ schedule: { type: 'cron', cronExpr: '0 9 * * *', tzOffsetH: 7 } }), da, []);
    expect(job.scheduleType).toBe('cron');
    expect(job.cronExpr).toBe('0 9 * * *');
    expect(job.tzOffsetH).toBe(7);
    expect(job.intervalS).toBeNull();
  });

  it('maps a window schedule', () => {
    const { job } = buildJobInsert(payload({ schedule: {
      type: 'window', minIntervalS: 600, maxIntervalS: 1800, dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7,
    } }), da, []);
    expect(job.scheduleType).toBe('window');
    expect(job.minIntervalS).toBe(600);
    expect(job.dayEndHour).toBe(23);
  });

  it('rejects an invalid cron via CreateJobError', () => {
    expect(() => buildJobInsert(payload({ schedule: { type: 'cron', cronExpr: 'nope', tzOffsetH: 7 } }), da, []))
      .toThrow(CreateJobError);
  });

  it('rejects customSettings that fail the type schema', () => {
    // DA's schema expects cookie_expires_at to be number|null; a string fails.
    expect(() => buildJobInsert(payload({ customSettings: { cookie_expires_at: 'soon' } }), da, []))
      .toThrow(CreateJobError);
  });

  it('passes recipients through with tag defaulting to null', () => {
    const { recipients } = buildJobInsert(payload({ recipients: [{ name: 'A', phone: '628111', tag: 'new-task' }, { name: 'B', phone: '628222' }] }), da, []);
    expect(recipients).toEqual([
      { name: 'A', phone: '628111', tag: 'new-task' },
      { name: 'B', phone: '628222', tag: null },
    ]);
  });
});
```

- [ ] **Step 6: Run to verify fail**

Run: `npx vitest run lib/jobs/create-job.test.ts`
Expected: FAIL — `./create-job` does not exist.

- [ ] **Step 7: Implement `lib/jobs/create-job.ts`**

```ts
import { z } from 'zod';
import { jobs } from '@/lib/db/schema';
import type { JobModule } from './types';
import { slugify, nextAvailableSlug } from './slug';
import { validateSchedule, type ScheduleCfg } from '@/lib/scheduler/window';

export class CreateJobError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; this.name = 'CreateJobError'; }
}

const scheduleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('window'),
    minIntervalS: z.number().int().min(30).max(86400),
    maxIntervalS: z.number().int().min(30).max(86400),
    dayStartHour: z.number().int().min(0).max(23),
    dayEndHour:   z.number().int().min(1).max(24),
    tzOffsetH:    z.number().int().min(-12).max(14),
  }),
  z.object({
    type: z.literal('interval'),
    intervalS: z.number().int().min(30).max(86400),
  }),
  z.object({
    type: z.literal('cron'),
    cronExpr:  z.string().min(1),
    tzOffsetH: z.number().int().min(-12).max(14),
  }),
]);

export const createJobSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  enabled: z.boolean().optional(),
  schedule: scheduleSchema,
  customSettings: z.unknown().optional(),
  recipients: z.array(z.object({
    name:  z.string().min(1),
    phone: z.string().min(5),
    tag:   z.string().optional(),
  })).optional(),
});
export type CreateJobPayload = z.infer<typeof createJobSchema>;

export function buildJobInsert(
  payload: CreateJobPayload,
  mod: JobModule,
  existingSlugs: string[],
): { job: typeof jobs.$inferInsert; recipients: { name: string; phone: string; tag: string | null }[] } {
  // slug
  let slug: string;
  if (payload.slug) {
    if (existingSlugs.includes(payload.slug)) throw new CreateJobError(`slug '${payload.slug}' already exists`, 409);
    slug = payload.slug;
  } else {
    slug = nextAvailableSlug(slugify(payload.name), existingSlugs);
  }

  // custom settings validated against the type's schema
  const customSettings = (payload.customSettings ?? {}) as Record<string, unknown>;
  if (mod.customSettingsSchema) {
    const r = mod.customSettingsSchema.safeParse(customSettings);
    if (!r.success) throw new CreateJobError(`invalid customSettings: ${r.error.issues.map(i => i.message).join('; ')}`);
  }

  // schedule → flat columns (unset window columns fall back to DB defaults)
  const s = payload.schedule;
  const scheduleCols: Partial<typeof jobs.$inferInsert> =
    s.type === 'window'
      ? { scheduleType: 'window', minIntervalS: s.minIntervalS, maxIntervalS: s.maxIntervalS,
          dayStartHour: s.dayStartHour, dayEndHour: s.dayEndHour, tzOffsetH: s.tzOffsetH,
          intervalS: null, cronExpr: null }
      : s.type === 'interval'
      ? { scheduleType: 'interval', intervalS: s.intervalS, cronExpr: null }
      : { scheduleType: 'cron', cronExpr: s.cronExpr, tzOffsetH: s.tzOffsetH, intervalS: null };

  // validate the resulting schedule (catches bad cron) using a fully-populated cfg
  const cfgForValidation: ScheduleCfg = {
    scheduleType: scheduleCols.scheduleType as ScheduleCfg['scheduleType'],
    minIntervalS: scheduleCols.minIntervalS ?? 600,
    maxIntervalS: scheduleCols.maxIntervalS ?? 1800,
    dayStartHour: scheduleCols.dayStartHour ?? 7,
    dayEndHour:   scheduleCols.dayEndHour ?? 23,
    tzOffsetH:    scheduleCols.tzOffsetH ?? 7,
    intervalS:    scheduleCols.intervalS ?? null,
    cronExpr:     scheduleCols.cronExpr ?? null,
  };
  try { validateSchedule(cfgForValidation); }
  catch (e) { throw new CreateJobError(e instanceof Error ? e.message : 'invalid schedule'); }

  const job: typeof jobs.$inferInsert = {
    slug,
    type: payload.type,
    title: payload.name,
    url: mod.defaultMeta.url,
    description: mod.defaultMeta.description,
    enabled: payload.enabled ?? true,
    customSettings,
    ...scheduleCols,
  };

  const recipients = (payload.recipients ?? []).map(r => ({ name: r.name, phone: r.phone, tag: r.tag ?? null }));
  return { job, recipients };
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run lib/jobs/create-job.test.ts lib/jobs/slug.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/jobs/slug.ts lib/jobs/slug.test.ts lib/jobs/create-job.ts lib/jobs/create-job.test.ts
git commit -m "feat(jobs): pure create-instance core (slug helpers + payload builder)"
```

---

### Task 6: Routes — `POST /api/jobs` + `DELETE /api/jobs/[slug]`

Thin route wiring over Task 5's builder and the scheduler.

**Files:**
- Create: `app/api/jobs/route.ts`
- Modify: `app/api/jobs/[slug]/route.ts` (add `DELETE`)

**Interfaces:**
- Consumes: `createJobSchema`/`buildJobInsert`/`CreateJobError` (Task 5), `getJob` (registry), `reschedule`/`unschedule` (scheduler), `jobs`/`recipients` schema.

- [ ] **Step 1: Implement `POST` in `app/api/jobs/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { getJob } from '@/lib/jobs/registry';
import { createJobSchema, buildJobInsert, CreateJobError } from '@/lib/jobs/create-job';
import { reschedule } from '@/lib/scheduler';

export async function POST(req: NextRequest) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;

  const parsed = createJobSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const payload = parsed.data;

  const mod = getJob(payload.type);
  if (!mod) return NextResponse.json({ error: `unknown job type '${payload.type}'` }, { status: 400 });

  const existing = await db.select({ slug: jobs.slug }).from(jobs);
  let built;
  try { built = buildJobInsert(payload, mod, existing.map(r => r.slug)); }
  catch (e) {
    if (e instanceof CreateJobError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const [row] = await db.insert(jobs).values(built.job).returning();
  if (built.recipients.length) {
    await db.insert(recipients).values(built.recipients.map(r => ({ jobId: row.id, ...r })));
  }
  await reschedule(row.id); // arms timers if enabled; clears nextRunAt if not

  return NextResponse.json({ job: { id: row.id, slug: row.slug, type: row.type } }, { status: 201 });
}
```

- [ ] **Step 2: Add `DELETE` to `app/api/jobs/[slug]/route.ts`**

Add the import and handler (keep the existing `GET`):

```ts
import { unschedule } from '@/lib/scheduler';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  unschedule(job.id);
  await db.delete(jobs).where(eq(jobs.id, job.id)); // FK cascade removes recipients + run_history
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "api/jobs" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add app/api/jobs/route.ts "app/api/jobs/[slug]/route.ts"
git commit -m "feat(api): POST /api/jobs (create instance) + DELETE /api/jobs/[slug]"
```

---

### Task 7: Extend settings PATCH for schedule types

Let an existing instance switch/adjust its schedule type, with validation + re-arm.

**Files:**
- Modify: `app/api/jobs/[slug]/settings/route.ts`

**Interfaces:**
- Consumes: `validateSchedule`/`ScheduleCfg` (Task 2), `reschedule` (scheduler).

- [ ] **Step 1: Extend the schedule schema**

In `app/api/jobs/[slug]/settings/route.ts`, add the three fields to `scheduleSchema`:

```ts
const scheduleSchema = z.object({
  scheduleType: z.enum(['window', 'interval', 'cron']).optional(),
  intervalS:    z.number().int().min(30).max(86400).nullable().optional(),
  cronExpr:     z.string().min(1).nullable().optional(),
  minIntervalS: z.number().int().min(30).max(86400).optional(),
  maxIntervalS: z.number().int().min(30).max(86400).optional(),
  dayStartHour: z.number().int().min(0).max(23).optional(),
  dayEndHour:   z.number().int().min(1).max(24).optional(),
  tzOffsetH:    z.number().int().min(-12).max(14).optional(),
  enabled:      z.boolean().optional(),
}).strict();
```

- [ ] **Step 2: Replace the window-only checks with `validateSchedule` on the merged cfg**

Add the import:

```ts
import { validateSchedule, type ScheduleCfg } from '@/lib/scheduler/window';
```

Replace the `min/max` and `startH/endH` guard block (the lines computing `min`,`max`,`startH`,`endH` and their two `if` checks) with a merged-cfg validation:

```ts
  const mergedCfg: ScheduleCfg = {
    scheduleType: (body.schedule?.scheduleType ?? job.scheduleType) as ScheduleCfg['scheduleType'],
    minIntervalS: body.schedule?.minIntervalS ?? job.minIntervalS,
    maxIntervalS: body.schedule?.maxIntervalS ?? job.maxIntervalS,
    dayStartHour: body.schedule?.dayStartHour ?? job.dayStartHour,
    dayEndHour:   body.schedule?.dayEndHour   ?? job.dayEndHour,
    tzOffsetH:    body.schedule?.tzOffsetH    ?? job.tzOffsetH,
    intervalS:    body.schedule?.intervalS    ?? job.intervalS,
    cronExpr:     body.schedule?.cronExpr     ?? job.cronExpr,
  };
  try { validateSchedule(mergedCfg); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid schedule' }, { status: 400 }); }
```

The existing `db.update(jobs).set({ ...(body.schedule ?? {}), ... })` already writes any provided schedule fields (including the three new ones) and is followed by `reschedule(job.id)` — leave those as-is.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "settings/route" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/jobs/[slug]/settings/route.ts"
git commit -m "feat(api): settings PATCH accepts scheduleType/intervalS/cronExpr"
```

---

### Task 8: Full verification + multi-instance scheduling test

Prove the phase holds together and DataAnnotation still behaves as today.

**Files:**
- Create: `lib/scheduler/multi-instance.test.ts`

- [ ] **Step 1: Multi-instance scheduling test (pure)**

Create `lib/scheduler/multi-instance.test.ts` — verifies two instances of different schedule types compute independent next-run times:

```ts
import { describe, it, expect } from 'vitest';
import { computeNextRunAt, type ScheduleCfg } from './window';

const cfg = (over: Partial<ScheduleCfg>): ScheduleCfg => ({
  scheduleType: 'window', minIntervalS: 600, maxIntervalS: 1800,
  dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7, intervalS: null, cronExpr: null, ...over,
});

describe('independent instances', () => {
  it('interval and cron instances compute different next-runs from the same now', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const a = computeNextRunAt(now, cfg({ scheduleType: 'interval', intervalS: 300 }));
    const b = computeNextRunAt(now, cfg({ scheduleType: 'cron', cronExpr: '0 9 * * *' }));
    expect(a.toISOString()).toBe('2026-07-01T00:05:00.000Z');
    expect(b.toISOString()).toBe('2026-07-01T02:00:00.000Z');
    expect(a.getTime()).not.toBe(b.getTime());
  });
});
```

- [ ] **Step 2: Run the full suite**

Run: `npx vitest run`
Expected: all suites PASS (Phase 1 suites + new: window interval/cron/validate, unschedule, slug, create-job, multi-instance, registry listJobTypes).

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Manual API smoke (optional, needs the Docker DB + dev server)**

Start dev with env (`npm run dev`), sign in to get a `session` cookie, then exercise the API (replace `<cookie>`):

```bash
# list installed types
curl -s -H "Cookie: session=<cookie>" localhost:3000/api/jobs/types
# create a second DataAnnotation instance on a 5-min interval
curl -s -X POST -H "Cookie: session=<cookie>" -H 'content-type: application/json' \
  -d '{"type":"data-annotation","name":"DA Test","schedule":{"type":"interval","intervalS":300}}' \
  localhost:3000/api/jobs
# confirm it appears on the dashboard, then delete it
curl -s -X DELETE -H "Cookie: session=<cookie>" localhost:3000/api/jobs/da-test
```

Expected: types lists `data-annotation`; create returns `201` with the new slug and the instance appears on the dashboard with its own schedule/countdown; delete returns `204` and it disappears. (DataAnnotation's original instance is untouched throughout.)

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "test: Phase 2 multi-instance verification" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (Phase 2 design):**
- §3 schema (`scheduleType`/`intervalS`/`cronExpr`, slug per-instance) → Task 1 ✓
- §4 schedule engine branches + `validateSchedule` + cron offset model → Task 2; scheduler `jobCfg` → Task 3 ✓
- §5 registry catalog, remove auto-seed, `GET /api/jobs/types` → Task 4 ✓
- §6 `POST /api/jobs` (type/schedule/customSettings validation, slug derive, recipients, arm), `DELETE /api/jobs/[slug]` (cascade + timer cleanup), settings PATCH extension → Tasks 5–7 ✓
- §7 multi-instance wiring (`unschedule`, per-job arm/clear) → Tasks 3, 6, 8 ✓
- Locked decisions: API-only (no UI) ✓; croner ✓; cookie-expiry untouched ✓; auto-slug+override ✓; rawHtml kept ✓; no role changes ✓; nested `schedule` union ✓
- Out of scope (correctly absent): Split Console UI (Phase 4), roles/guest/masking/`visibleToGuest` (Phase 3), cookie-expiry generalization, `debug` rename, project rename (Phase 5).

**Placeholder scan:** No TBD/TODO; every code step shows full content; the migration is concrete; the only "copy + edit" step (Task 1 Step 3) is validated by the drizzle-kit "No schema changes" check.

**Type consistency:** `ScheduleCfg` (Task 2) is consumed unchanged by `jobCfg` (Task 3), `buildJobInsert` validation (Task 5), and settings PATCH (Task 7). `computeNextRunAt(now, cfg)`/`isWithinWindow(now, cfg)`/`validateSchedule(cfg)`/`cronNextRun(now, expr, tz)`/`unschedule(jobId)`/`listJobTypes()`/`slugify`/`nextAvailableSlug`/`createJobSchema`/`buildJobInsert`/`CreateJobError` names are identical across the tasks that define and use them. `jobs.$inferInsert` is the single source for insert shape.
