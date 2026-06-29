# Background Worker — Phase 1: Generic Core + Schema Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip DataAnnotation-specific vocabulary out of the job runtime so the core is domain-agnostic, while DataAnnotation keeps working exactly as today as the first registered job *type*.

**Architecture:** Generalize the `JobModule` contract to `{ type, run() }` returning a generic `{ status, summary, data }`. Move diff-and-notify out of the runtime into opt-in helpers. Migrate the DB so `run_history` carries a generic `summary`/`data` payload instead of typed counters, `jobs` gains a `type` column, and `recipients.kind` becomes a free-form `tag`. Refactor the scheduler and DataAnnotation module onto the new contract; keep a forward-only data migration so the existing production row survives the upgrade.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Drizzle ORM + PostgreSQL, Vitest, WAHA (WhatsApp). Read `node_modules/next/dist/docs/` before touching Next-specific code per `AGENTS.md`.

## Global Constraints

- Next.js is a modified build — APIs may differ from training data. Read the relevant guide under `node_modules/next/dist/docs/` before writing Next code (`AGENTS.md`).
- Migrations run automatically on boot via `instrumentation.ts → runMigrations`; the migrator (`lib/db/migrate.ts`) applies `lib/db/migrations/*.sql` in `meta/_journal.json` order. New migrations need a matching journal entry + snapshot — generate them with `npx drizzle-kit generate` (config: `drizzle.config.ts`), never hand-author the journal.
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. Run tests with `npm run test` (Vitest). Vitest resolves the `@/` alias to repo root (`vitest.config.ts`).
- End of Phase 1, the app must build (`npm run build`) and behave exactly as today for DataAnnotation. No behavior change is in scope — this is a pure refactor + migration.
- Frequent commits: one per task minimum.

## Phasing Roadmap (context — only Phase 1 is detailed here)

- **Phase 1 (this plan):** Generic core + schema migration. App unchanged in behavior.
- **Phase 2:** Multi-instance jobs + schedule types (`interval`/`cron`/`window`) + "submit a job" instance-creation API. Stop auto-seeding instances; registry becomes a type catalog.
- **Phase 3:** Access control — `admin`/`guest` session roles, server-side PII masking (`maskForRole`), per-job `visibleToGuest`, write-route guards.
- **Phase 4:** UI overhaul — Split Console (rail + detail), Settings (Notifications, Access), restyle to the portfolio dark/cyan theme.
- **Phase 5:** Project rename `auto-checker → background-worker` (package/repo/folder) + repo-root cleanup (move `example_response.html` into the module; delete `example_headers.txt`, `cron_response.json`).

---

### Task 1: Generalize the core job contract types

Make `JobModule`/`RunResult`/`RunContext` domain-agnostic and move the DataAnnotation-only `PaidItem` type into the DataAnnotation module.

**Files:**
- Modify: `lib/jobs/types.ts` (replace contents)
- Create: `lib/jobs/data-annotation/types.ts`
- Test: `lib/jobs/types.test.ts`

**Interfaces:**
- Produces:
  - `RunStatus = 'ok' | 'error' | 'skipped'`
  - `interface RunResult { status: RunStatus; summary: string; data?: unknown; errorMessage?: string; rawHtml?: string; notificationSent: boolean }`
  - `interface Recipient { id: number; name: string; phone: string; tag: string | null }`
  - `type Notify = (message: string, opts?: { tag?: string }) => Promise<boolean>`
  - `interface RunContext { jobId: number; meta: { title: string; url: string; description: string }; custom: unknown; db: typeof db; recipients: Recipient[]; lastSuccessful: unknown; notify: Notify }`
  - `interface JobModule { type: string; defaultMeta: {...}; customSettingsSchema?: ZodSchema; CustomSettingsPanel?: ComponentType<{ jobId: number; current: unknown }>; run(ctx: RunContext): Promise<RunResult> }`
  - `lib/jobs/data-annotation/types.ts` → `interface PaidItem { id: string; name: string; pay: string; availableTasksFor: string; created: string; qualification: boolean }`

- [ ] **Step 1: Write the failing test**

Create `lib/jobs/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { JobModule, RunResult, RunContext } from './types';

describe('generic job contract', () => {
  it('a module conforms with type + run() returning status/summary', async () => {
    const mod: JobModule = {
      type: 'demo',
      defaultMeta: { title: 'Demo', url: 'https://example.com', description: 'x' },
      async run(_ctx: RunContext): Promise<RunResult> {
        return { status: 'ok', summary: 'did a thing', data: { n: 1 }, notificationSent: false };
      },
    };
    expect(mod.type).toBe('demo');
    const res = await mod.run({} as RunContext);
    expect(res.status).toBe('ok');
    expect(res.summary).toBe('did a thing');
    expect((res.data as { n: number }).n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/jobs/types.test.ts`
Expected: FAIL — current `JobModule` has `slug`/`runCheck`, not `type`/`run`; TypeScript/Vitest errors on the object literal.

- [ ] **Step 3: Replace `lib/jobs/types.ts`**

```ts
import type { ComponentType } from 'react';
import type { ZodSchema } from 'zod';
import type { db } from '@/lib/db/client';

export type RunStatus = 'ok' | 'error' | 'skipped';

export interface RunResult {
  status: RunStatus;
  /** Short human-readable line for the dashboard, e.g. "4 new paid projects". */
  summary: string;
  /** Free-form payload the job type defines for itself (persisted as JSONB). */
  data?: unknown;
  errorMessage?: string;
  /** Optional debug blob captured on error (e.g. raw HTML). */
  rawHtml?: string;
  notificationSent: boolean;
}

export interface Recipient {
  id: number;
  name: string;
  phone: string;
  /** Free-form grouping the job type defines, e.g. 'new-task' | 'cookie-expiry'. */
  tag: string | null;
}

/** Fan-out sender injected into a run. Filters recipients by `tag` when given. */
export type Notify = (message: string, opts?: { tag?: string }) => Promise<boolean>;

export interface RunContext {
  jobId: number;
  meta: { title: string; url: string; description: string };
  custom: unknown;
  db: typeof db;
  recipients: Recipient[];
  /** `data` from the previous successful run of this instance (job-defined shape). */
  lastSuccessful: unknown;
  notify: Notify;
}

export interface JobModule {
  /** Stable id of the job TYPE (which module powers an instance), e.g. 'data-annotation'. */
  type: string;
  defaultMeta: { title: string; url: string; description: string };
  customSettingsSchema?: ZodSchema;
  CustomSettingsPanel?: ComponentType<{ jobId: number; current: unknown }>;
  run(ctx: RunContext): Promise<RunResult>;
}
```

Create `lib/jobs/data-annotation/types.ts`:

```ts
export interface PaidItem {
  id: string;
  name: string;
  pay: string;
  availableTasksFor: string;
  created: string;
  qualification: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/jobs/types.test.ts`
Expected: PASS. (Other files referencing `PaidItem`/`runCheck` will not compile yet — fixed in later tasks. Do not run a full build here.)

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/types.ts lib/jobs/data-annotation/types.ts lib/jobs/types.test.ts
git commit -m "refactor(jobs): generic JobModule contract (type/run, status/summary/data)"
```

---

### Task 2: Shared, generic diff helper

Replace DataAnnotation's `diffNewItems(current, prev)` with a reusable generic `diffNewItems<T>(current, previous, keyFn)` in a shared location.

**Files:**
- Create: `lib/jobs/shared/diff.ts`
- Create: `lib/jobs/shared/diff.test.ts`
- Delete: `lib/jobs/data-annotation/diff.ts`, `lib/jobs/data-annotation/diff.test.ts` (superseded; deletion happens in Step 5)

**Interfaces:**
- Produces: `diffNewItems<T>(current: T[], previous: T[], keyFn: (item: T) => string): T[]`

- [ ] **Step 1: Write the failing test**

Create `lib/jobs/shared/diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffNewItems } from './diff';

const item = (id: string) => ({ id, name: id });

describe('diffNewItems (generic)', () => {
  it('returns items present now but absent in the previous set', () => {
    expect(diffNewItems([item('a'), item('b')], [item('a')], i => i.id).map(i => i.id)).toEqual(['b']);
  });
  it('returns nothing when current is a subset of previous', () => {
    expect(diffNewItems([item('a')], [item('a'), item('b')], i => i.id)).toEqual([]);
  });
  it('treats reappearance (absent in previous) as new', () => {
    expect(diffNewItems([item('a'), item('b')], [item('b')], i => i.id).map(i => i.id)).toEqual(['a']);
  });
  it('returns all current items when previous is empty', () => {
    expect(diffNewItems([item('a'), item('b')], [], i => i.id).map(i => i.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/jobs/shared/diff.test.ts`
Expected: FAIL — `./diff` does not exist.

- [ ] **Step 3: Implement `lib/jobs/shared/diff.ts`**

```ts
/** Items in `current` whose key is absent from `previous`. Key identity decides "new". */
export function diffNewItems<T>(current: T[], previous: T[], keyFn: (item: T) => string): T[] {
  const prev = new Set(previous.map(keyFn));
  return current.filter(i => !prev.has(keyFn(i)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/jobs/shared/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete the superseded DataAnnotation diff + its test, commit**

```bash
git rm lib/jobs/data-annotation/diff.ts lib/jobs/data-annotation/diff.test.ts
git add lib/jobs/shared/diff.ts lib/jobs/shared/diff.test.ts
git commit -m "refactor(jobs): generic diffNewItems<T> helper in jobs/shared"
```

---

### Task 3: Notification fan-out helper (`ctx.notify`)

Decouple job code from WAHA: jobs call `ctx.notify(msg, { tag })`; a builder fans out to recipients over a channel. Only the WAHA channel is implemented (per spec §6 / §10 — abstraction seam only, no new channels).

**Files:**
- Create: `lib/notify.ts`
- Create: `lib/notify.test.ts`

**Interfaces:**
- Consumes: `Recipient`, `Notify` from `lib/jobs/types`; `WahaClient` from `lib/waha`.
- Produces:
  - `interface NotificationChannel { sendText(to: string, msg: string): Promise<boolean> }`
  - `wahaChannelFromEnv(): NotificationChannel | null` (null when `WAHA_URL` unset)
  - `buildNotifier(recipients: Recipient[], channel: NotificationChannel | null): Notify`

- [ ] **Step 1: Write the failing test**

Create `lib/notify.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildNotifier } from './notify';
import type { Recipient } from '@/lib/jobs/types';

const recips: Recipient[] = [
  { id: 1, name: 'A', phone: '111', tag: 'new-task' },
  { id: 2, name: 'B', phone: '222', tag: 'cookie-expiry' },
  { id: 3, name: 'C', phone: '333', tag: 'new-task' },
];

describe('buildNotifier', () => {
  it('sends to all recipients when no tag given', async () => {
    const sendText = vi.fn().mockResolvedValue(true);
    const notify = buildNotifier(recips, { sendText });
    const sent = await notify('hi');
    expect(sent).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(3);
  });

  it('filters recipients by tag', async () => {
    const sendText = vi.fn().mockResolvedValue(true);
    const notify = buildNotifier(recips, { sendText });
    await notify('hi', { tag: 'new-task' });
    expect(sendText.mock.calls.map(c => c[0])).toEqual(['111', '333']);
  });

  it('returns false and does not throw when channel is null', async () => {
    const notify = buildNotifier(recips, null);
    expect(await notify('hi')).toBe(false);
  });

  it('keeps going if one send throws, returns true if any succeeded', async () => {
    const sendText = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    const notify = buildNotifier(recips.filter(r => r.tag === 'new-task'), { sendText });
    expect(await notify('hi', { tag: 'new-task' })).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/notify.test.ts`
Expected: FAIL — `./notify` does not exist.

- [ ] **Step 3: Implement `lib/notify.ts`**

```ts
import { WahaClient } from '@/lib/waha';
import type { Notify, Recipient } from '@/lib/jobs/types';

export interface NotificationChannel {
  sendText(to: string, msg: string): Promise<boolean>;
}

/** The single global WhatsApp sender, or null when WAHA isn't configured. */
export function wahaChannelFromEnv(): NotificationChannel | null {
  const url = process.env.WAHA_URL;
  if (!url) return null;
  const waha = new WahaClient(url, process.env.WAHA_API_KEY ?? '');
  return { sendText: (to, msg) => waha.sendText(to, msg) };
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/notify.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/notify.ts lib/notify.test.ts
git commit -m "feat(notify): channel abstraction + buildNotifier fan-out (WAHA only)"
```

---

### Task 4: DB schema + generalize migration

Add `jobs.type`, rename `recipients.kind → tag` (free-form, nullable), and replace the 9 DataAnnotation-specific `run_history` columns with generic `summary` + `data`. Backfill existing rows forward.

**Files:**
- Modify: `lib/db/schema.ts`
- Create (via drizzle-kit): `lib/db/migrations/0002_generalize_job_model.sql` + `meta/0002_snapshot.json` + updated `meta/_journal.json`
- Modify (hand-edit the generated SQL body): `lib/db/migrations/0002_generalize_job_model.sql`

**Interfaces:**
- Produces (Drizzle inferred): `Job` now has `type: string`; `Recipient` now has `tag: string | null` (no `kind`); `RunHistory` now has `summary: string`, `data: unknown`, and **no** `paidProjects`/`allProjects`/`paidQualifications`/`allQualifications`/`newPaidProjects`/`newAllProjects`/`newPaidQualifications`/`newAllQualifications`/`extractedItems`.

- [ ] **Step 1: Edit `lib/db/schema.ts`**

In the `jobs` table, add `type` immediately after `slug`:

```ts
  slug:           text('slug').notNull().unique(),
  type:           text('type').notNull(),
```

In the `recipients` table, replace the `kind` column with `tag`:

```ts
    // free-form grouping the job type defines (e.g. 'new-task', 'cookie-expiry')
    tag:       text('tag'),
```

(Delete the old `kind: text('kind').notNull().default('project'),` line and its comment.)

Replace the `run_history` column block — remove the 9 typed columns and add `summary` + `data`. The full new table:

```ts
export const runHistory = pgTable(
  'run_history',
  {
    id:               bigserial('id', { mode: 'number' }).primaryKey(),
    jobId:            integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    startedAt:        timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt:       timestamp('finished_at', { withTimezone: true }).notNull(),
    status:           text('status').notNull(),
    triggerType:      text('trigger_type').notNull(),
    skipReason:       text('skip_reason'),
    diffMs:           integer('diff_ms'),
    summary:          text('summary').notNull().default(''),
    data:             jsonb('data'),
    rawHtml:          text('raw_html'),
    errorMessage:     text('error_message'),
    notificationSent: boolean('notification_sent').notNull().default(false),
  },
  t => ({ jobStartedIdx: index('run_history_job_started_idx').on(t.jobId, t.startedAt) }),
);
```

- [ ] **Step 2: Generate the migration scaffold**

Run: `npx drizzle-kit generate --name generalize_job_model`
Expected: creates `lib/db/migrations/0002_generalize_job_model.sql`, `meta/0002_snapshot.json`, and appends an entry to `meta/_journal.json`. If prompted whether `kind`→`tag` is a rename, choose **rename** (not drop+create). **Keep the generated snapshot + journal**; you will overwrite only the `.sql` body in the next step so data is preserved.

- [ ] **Step 3: Replace the `.sql` body with the data-preserving version**

Overwrite `lib/db/migrations/0002_generalize_job_model.sql` with exactly:

```sql
ALTER TABLE "jobs" ADD COLUMN "type" text;--> statement-breakpoint
UPDATE "jobs" SET "type" = "slug" WHERE "type" IS NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "recipients" RENAME COLUMN "kind" TO "tag";--> statement-breakpoint
ALTER TABLE "recipients" ALTER COLUMN "tag" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recipients" ALTER COLUMN "tag" DROP NOT NULL;--> statement-breakpoint
UPDATE "recipients" SET "tag" = 'new-task' WHERE "tag" = 'project';--> statement-breakpoint
UPDATE "recipients" SET "tag" = 'cookie-expiry' WHERE "tag" = 'cookie';--> statement-breakpoint

ALTER TABLE "run_history" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_history" ADD COLUMN "data" jsonb;--> statement-breakpoint
UPDATE "run_history" SET "data" = jsonb_build_object(
  'paidProjects', "paid_projects", 'allProjects', "all_projects",
  'paidQualifications', "paid_qualifications", 'allQualifications', "all_qualifications",
  'newPaidProjects', "new_paid_projects", 'newAllProjects', "new_all_projects",
  'newPaidQualifications', "new_paid_qualifications", 'newAllQualifications', "new_all_qualifications",
  'items', "extracted_items"
);--> statement-breakpoint
UPDATE "run_history" SET "summary" =
  CASE WHEN ("new_paid_projects" + "new_all_projects" + "new_paid_qualifications" + "new_all_qualifications") > 0
       THEN ('+' || ("new_paid_projects" + "new_all_projects")::text || ' projects, +'
              || ("new_paid_qualifications" + "new_all_qualifications")::text || ' quals')
       ELSE 'no change' END
  WHERE "status" = 'ok';--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "paid_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "all_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "paid_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "all_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_paid_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_all_projects";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_paid_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "new_all_qualifications";--> statement-breakpoint
ALTER TABLE "run_history" DROP COLUMN "extracted_items";
```

- [ ] **Step 4: Apply and verify against a database**

Run: `npm run migrate`
Expected: completes without error. Verify columns with a quick check:

```bash
psql "$DATABASE_URL" -c "\d run_history" -c "\d jobs" -c "\d recipients"
```
Expected: `jobs.type` present + NOT NULL; `recipients.tag` present, nullable, no default; `run_history` has `summary`,`data` and none of the 9 dropped columns. Existing `jobs` row has `type = 'data-annotation'`.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0002_generalize_job_model.sql lib/db/migrations/meta/0002_snapshot.json lib/db/migrations/meta/_journal.json
git commit -m "feat(db): generalize run_history to summary/data, add jobs.type, recipients.tag"
```

---

### Task 5: Refactor the DataAnnotation module onto the new contract

Rename `slug→type`, `runCheck→run`; compute a `summary`; pack counters + items into `data`; diff via the shared helper against `ctx.lastSuccessful`; notify via `ctx.notify(..., { tag: 'new-task' })`. Cookie-state persistence is unchanged.

**Files:**
- Modify: `lib/jobs/data-annotation/index.ts` (replace contents)
- Modify: `lib/jobs/data-annotation/parse.ts` (fix `PaidItem` import only)
- Test: `lib/jobs/data-annotation/index.test.ts`

**Interfaces:**
- Consumes: `JobModule`/`RunContext`/`RunResult` (Task 1), `diffNewItems` (Task 2), `PaidItem` (`./types`), `fetchDataAnnotationPage`/`parseDataAnnotation`/`extractPaidItems`/`extractSessionExpiry` (`./fetch`,`./parse`), `formatNotification` (`./format`), `decrypt` (`@/lib/crypto`).
- Produces: `dataAnnotation: JobModule` with `type: 'data-annotation'`; its `run()` returns `data` shaped `{ paidProjects, allProjects, paidQualifications, allQualifications, newPaidProjects, newAllProjects, newPaidQualifications, newAllQualifications, items: PaidItem[] }`.

- [ ] **Step 1: Fix the `PaidItem` import in `parse.ts`**

In `lib/jobs/data-annotation/parse.ts`, change the import of `PaidItem` from `@/lib/jobs/types` to the local module type:

```ts
import type { PaidItem } from './types';
```
(If `parse.ts` imports other names from `@/lib/jobs/types`, leave those; only `PaidItem` moves.)

- [ ] **Step 2: Write the failing test**

Create `lib/jobs/data-annotation/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dataAnnotation } from './index';

describe('dataAnnotation module shape', () => {
  it('is registered under type data-annotation with a run()', () => {
    expect(dataAnnotation.type).toBe('data-annotation');
    expect(typeof dataAnnotation.run).toBe('function');
  });

  it('errors with a summary (not counters) when no cookie configured', async () => {
    const res = await dataAnnotation.run({
      jobId: 1,
      meta: dataAnnotation.defaultMeta,
      custom: {},                 // no cookie_encrypted
      db: {} as never,
      recipients: [],
      lastSuccessful: null,
      notify: async () => false,
    });
    expect(res.status).toBe('error');
    expect(res.notificationSent).toBe(false);
    expect(res.summary).toMatch(/cookie/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- lib/jobs/data-annotation/index.test.ts`
Expected: FAIL — module still exports `slug`/`runCheck`; `dataAnnotation.type` is undefined.

- [ ] **Step 4: Replace `lib/jobs/data-annotation/index.ts`**

```ts
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { fetchDataAnnotationPage } from './fetch';
import { parseDataAnnotation, extractPaidItems, extractSessionExpiry } from './parse';
import { formatNotification } from './format';
import { diffNewItems } from '@/lib/jobs/shared/diff';
import { decrypt } from '@/lib/crypto';
import { jobs } from '@/lib/db/schema';
import type { JobModule, RunContext, RunResult } from '../types';
import type { PaidItem } from './types';
import CustomSettingsPanel from './settings-panel';

export const customSettingsSchema = z.object({
  cookie_encrypted:  z.string().optional(),
  cookie_expires_at: z.number().nullable().optional(),
  cookie_checked_at: z.number().nullable().optional(),
  cookie_warned:     z.boolean().optional(),
  cookie_invalid:    z.boolean().optional(),
});

async function persistCookieState(ctx: RunContext, patch: Record<string, unknown>): Promise<void> {
  const base = (ctx.custom ?? {}) as Record<string, unknown>;
  await ctx.db.update(jobs)
    .set({ customSettings: { ...base, ...patch }, updatedAt: new Date() })
    .where(eq(jobs.id, ctx.jobId));
}

interface DaData {
  paidProjects: number;          allProjects: number;
  paidQualifications: number;    allQualifications: number;
  newPaidProjects: number;       newAllProjects: number;
  newPaidQualifications: number; newAllQualifications: number;
  items: PaidItem[];
}

export const dataAnnotation: JobModule = {
  type: 'data-annotation',
  defaultMeta: {
    title: 'Data Annotation',
    url: 'https://app.dataannotation.tech/workers/projects',
    description: 'Monitor paid projects and qualifications on DataAnnotation.',
  },
  customSettingsSchema,
  CustomSettingsPanel,

  async run(ctx: RunContext): Promise<RunResult> {
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
        await persistCookieState(ctx, { cookie_invalid: true });
        return mkError('Auth expired — please update cookie');
      }
      return mkError(`Fetch failed: ${msg}`);
    }

    const props = parseDataAnnotation(html);
    if (!props) return mkError(`Failed to parse response (HTML length: ${html.length})`, html);

    const expiresAt = extractSessionExpiry(html);
    const cookieState: Record<string, unknown> = { cookie_checked_at: Date.now(), cookie_invalid: false };
    if (expiresAt) cookieState.cookie_expires_at = expiresAt;
    await persistCookieState(ctx, cookieState);

    const items = extractPaidItems(props);
    const prevItems = ((ctx.lastSuccessful as DaData | null)?.items) ?? [];
    const newItems = diffNewItems(items, prevItems, i => i.id);

    const data: DaData = {
      allProjects:           items.filter(i => !i.qualification).length,
      allQualifications:     items.filter(i =>  i.qualification).length,
      paidProjects:          items.filter(i => !i.qualification && isPaidStr(i.pay)).length,
      paidQualifications:    items.filter(i =>  i.qualification && isPaidStr(i.pay)).length,
      newAllProjects:        newItems.filter(i => !i.qualification).length,
      newAllQualifications:  newItems.filter(i =>  i.qualification).length,
      newPaidProjects:       newItems.filter(i => !i.qualification && isPaidStr(i.pay)).length,
      newPaidQualifications: newItems.filter(i =>  i.qualification && isPaidStr(i.pay)).length,
      items,
    };

    let notificationSent = false;
    if (newItems.length > 0) {
      notificationSent = await ctx.notify(formatNotification(newItems), { tag: 'new-task' });
    }

    const summary = newItems.length > 0
      ? `+${data.newAllProjects} projects, +${data.newAllQualifications} quals`
      : 'no change';

    return { status: 'ok', summary, data, notificationSent };
  },
};

function isPaidStr(pay: string): boolean { return pay?.includes('$') ?? false; }

function mkError(message: string, rawHtml?: string): RunResult {
  return { status: 'error', summary: message, errorMessage: message, rawHtml, notificationSent: false };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- lib/jobs/data-annotation/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/data-annotation/index.ts lib/jobs/data-annotation/parse.ts lib/jobs/data-annotation/index.test.ts
git commit -m "refactor(data-annotation): adopt generic run() contract + ctx.notify + shared diff"
```

---

### Task 6: Registry + seed lookup by `type`

`getJob` must resolve by `type`; `seedRegistryJobs` must set `type` on inserted rows (seeding stays in Phase 1 so a fresh DB still gets a DataAnnotation instance; Phase 2 replaces it with the submit-a-job UI).

**Files:**
- Modify: `lib/jobs/registry.ts`
- Modify: `lib/jobs/seed.ts`
- Test: `lib/jobs/registry.test.ts`

**Interfaces:**
- Consumes: `jobRegistry`, `JobModule.type`.
- Produces: `getJob(type: string): JobModule | undefined`.

- [ ] **Step 1: Write the failing test**

Create `lib/jobs/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getJob } from './registry';

describe('getJob', () => {
  it('resolves a module by its type', () => {
    expect(getJob('data-annotation')?.type).toBe('data-annotation');
  });
  it('returns undefined for an unknown type', () => {
    expect(getJob('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/jobs/registry.test.ts`
Expected: FAIL — `getJob` currently matches `j.slug`, and `dataAnnotation.slug` no longer exists (so lookup returns undefined / type error).

- [ ] **Step 3: Update `lib/jobs/registry.ts`**

```ts
import type { JobModule } from './types';
import { dataAnnotation } from './data-annotation';

export const jobRegistry: JobModule[] = [dataAnnotation];

export function getJob(type: string): JobModule | undefined {
  return jobRegistry.find(j => j.type === type);
}
```

- [ ] **Step 4: Update `lib/jobs/seed.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { jobRegistry } from './registry';

/**
 * Phase 1: seed one instance per registered type if absent, keyed by slug == type.
 * (Phase 2 removes auto-seeding in favour of admin-created instances.)
 */
export async function seedRegistryJobs(): Promise<void> {
  for (const mod of jobRegistry) {
    const [existing] = await db.select().from(jobs).where(eq(jobs.slug, mod.type)).limit(1);
    if (existing) continue;
    await db.insert(jobs).values({
      slug: mod.type,
      type: mod.type,
      title: mod.defaultMeta.title,
      url: mod.defaultMeta.url,
      description: mod.defaultMeta.description,
    });
    console.log(`[seed] inserted job '${mod.type}'`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- lib/jobs/registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/registry.ts lib/jobs/seed.ts lib/jobs/registry.test.ts
git commit -m "refactor(jobs): resolve modules and seed by type"
```

---

### Task 7: Scheduler — generic result persistence + injected notifier

Update the scheduler to: look up the module by `job.type`; pass all recipients (with `tag`) plus a `notify` built from the WAHA channel; pass `ctx.lastSuccessful` (previous ok run's `data`); persist `summary`/`data` instead of the dropped columns; and make `fireExpiryWarning` target `tag = 'cookie-expiry'`. Behavior is preserved.

**Files:**
- Modify: `lib/scheduler/index.ts`

**Interfaces:**
- Consumes: `getJob` (by type, Task 6), `buildNotifier`/`wahaChannelFromEnv` (Task 3), `RunResult` (Task 1), generic `run_history` columns (Task 4).
- Produces: unchanged exported surface — `start`, `stop`, `reschedule`, `runManual`, `armExpiryTimer`, `schedulerStatus`, `ManualRunOutcome`, `RunResult` re-export.

- [ ] **Step 1: Update imports and the `loadLastSuccessful` helper**

At the top of `lib/scheduler/index.ts`, change the jobs/types import line and add the notifier import:

```ts
import type { RunResult } from '@/lib/jobs/types';
import { buildNotifier, wahaChannelFromEnv } from '@/lib/notify';
```
(Remove the old `import type { PaidItem, RunResult } from '@/lib/jobs/types';` — `PaidItem` is no longer used here.)

Replace `loadLastSuccessfulItems` with a data loader:

```ts
async function loadLastSuccessful(jobId: number): Promise<unknown> {
  const [row] = await db.select({ data: runHistory.data })
    .from(runHistory)
    .where(and(eq(runHistory.jobId, jobId), eq(runHistory.status, 'ok')))
    .orderBy(desc(runHistory.startedAt)).limit(1);
  return row?.data ?? null;
}
```

- [ ] **Step 2: Rewrite the module-execution block in `executeRun`**

Within `executeRun`, replace the module lookup, recipients query, `mod.runCheck(...)` call, and the `run_history` insert with:

```ts
    const mod = getJob(job.type);
    if (!mod) {
      const startedAt = new Date();
      await db.insert(runHistory).values({
        jobId, startedAt, finishedAt: startedAt,
        status: 'error', triggerType: trigger,
        errorMessage: `No JobModule registered for type '${job.type}'`,
        summary: `No JobModule for ${job.type}`,
        diffMs: await diffSincePrevRun(jobId, startedAt),
      });
      return { kind: 'ran', result: errorResult(`No JobModule for ${job.type}`) };
    }

    // Pass ALL recipients with their tags; the job filters via ctx.notify({ tag }).
    const recps = await db.select().from(recipients).where(eq(recipients.jobId, jobId));
    const notify = buildNotifier(
      recps.map(r => ({ id: r.id, name: r.name, phone: r.phone, tag: r.tag })),
      wahaChannelFromEnv(),
    );
    const lastSuccessful = await loadLastSuccessful(jobId);
    const startedAt = new Date();
    let result: RunResult;
    try {
      result = await mod.run({
        jobId,
        meta: { title: job.title, url: job.url, description: job.description },
        custom: job.customSettings,
        db,
        recipients: recps.map(r => ({ id: r.id, name: r.name, phone: r.phone, tag: r.tag })),
        lastSuccessful,
        notify,
      });
    } catch (err) {
      result = errorResult(err instanceof Error ? err.message : String(err));
    }
    const finishedAt = new Date();
    await db.insert(runHistory).values({
      jobId, startedAt, finishedAt,
      status: result.status, triggerType: trigger,
      diffMs: await diffSincePrevRun(jobId, startedAt),
      summary: result.summary,
      data: result.status === 'ok' ? (result.data ?? null) : null,
      rawHtml: result.status === 'error' ? result.rawHtml ?? null : null,
      errorMessage: result.errorMessage ?? null,
      notificationSent: result.notificationSent,
    });
    await db.update(jobs).set({ lastRunAt: finishedAt, updatedAt: finishedAt }).where(eq(jobs.id, jobId));
```

(The outside-window skip insert above it already only sets generic columns + `diffMs`; add `summary: 'skipped: outside window'` to that insert and `summary: 'skipped: lock busy'` to the lock-busy insert so the NOT NULL default isn't relied on for clarity. Leave their other fields as-is.)

- [ ] **Step 3: Point `fireExpiryWarning` at the `cookie-expiry` tag and fix `errorResult`**

In `fireExpiryWarning`, change the recipients query from `kind = 'cookie'` to:

```ts
    const recps = await db.select().from(recipients)
      .where(and(eq(recipients.jobId, jobId), eq(recipients.tag, 'cookie-expiry')));
```

Replace `errorResult` with the generic version:

```ts
function errorResult(message: string): RunResult {
  return { status: 'error', summary: message, errorMessage: message, notificationSent: false };
}
```

(`maybeAlertFailureStreak` already selects all recipients for the job — leave it unchanged.)

- [ ] **Step 4: Verify the scheduler compiles and unit tests pass**

Run: `npm run test -- lib/scheduler`
Expected: PASS — `window.test.ts` unaffected; no references to removed columns/`runCheck`/`PaidItem` remain. If TypeScript flags a leftover `kind`/`runCheck`/`paidProjects` reference, fix it to the generic equivalent.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduler/index.ts
git commit -m "refactor(scheduler): generic summary/data persistence + injected ctx.notify"
```

---

### Task 8: Read-side — history API + minimal UI render

The history API and a few dashboard components still select/render the dropped columns. Update them to the generic `summary`/`data` so the app compiles and shows runs. (Pretty per-type rendering is Phase 4; here we just keep it functional.)

**Files:**
- Modify: `app/api/jobs/[slug]/history/route.ts:44-57` (the `rows` select)
- Modify: `app/dashboard/jobs/[slug]/history-table.tsx`
- Modify: `app/dashboard/jobs/[slug]/page.tsx` and `app/dashboard/page.tsx` (only where dropped columns are read)

**Interfaces:**
- Consumes: `runHistory.summary`, `runHistory.data` (Task 4).

- [ ] **Step 1: Update the history `rows` select**

In `app/api/jobs/[slug]/history/route.ts`, replace the `db.select({...})` projection (lines ~44-57) with the generic columns:

```ts
  const rows = await db.select({
    id: runHistory.id,
    startedAt: runHistory.startedAt, finishedAt: runHistory.finishedAt,
    status: runHistory.status, triggerType: runHistory.triggerType,
    skipReason: runHistory.skipReason, diffMs: runHistory.diffMs,
    summary: runHistory.summary,
    notificationSent: runHistory.notificationSent,
  })
    .from(runHistory).where(where)
    .orderBy(desc(runHistory.startedAt))
    .limit(pageSize).offset((page - 1) * pageSize);
```

- [ ] **Step 2: Make `history-table.tsx` render `summary`**

Open `app/dashboard/jobs/[slug]/history-table.tsx`. Find the column(s) that render the per-row counts (e.g. cells reading `row.newPaidProjects`, `row.paidProjects`, etc.) and replace that block with a single summary cell:

```tsx
<td className="px-3 py-2 text-sm text-muted-foreground">{row.summary}</td>
```

Update the table header cells to match (a single "Result" column where the count columns were), and update the row TypeScript type used by this component so it has `summary: string` and no longer lists the removed count fields. The detail view (`detailId` path) returns the full `runHistory` row including `data`; if the component renders detail counters, read them from `detail.data` defensively, e.g.:

```tsx
const d = (detail?.data ?? {}) as Record<string, number>;
// e.g. d.newPaidProjects ?? 0
```

- [ ] **Step 3: Fix any remaining dropped-column reads on the dashboard pages**

Search and fix:

Run: `npx tsc --noEmit`
Expected: errors point at any remaining references to `paidProjects`/`allProjects`/`paidQualifications`/`allQualifications`/`newPaidProjects`/`newAllProjects`/`newPaidQualifications`/`newAllQualifications`/`extractedItems`/`kind`/`runCheck`. In `app/dashboard/page.tsx` and `app/dashboard/jobs/[slug]/page.tsx`, replace any such reads: prefer `row.summary` for list displays, or `(row.data as Record<string, number>)?.field ?? 0` where a specific number is shown. Re-run until `tsc --noEmit` is clean.

- [ ] **Step 4: Verify the production build**

Run: `npm run build`
Expected: build succeeds (no type errors, no missing-column references).

- [ ] **Step 5: Commit**

```bash
git add app/api/jobs/[slug]/history/route.ts app/dashboard
git commit -m "refactor(ui): render generic run summary/data in history + dashboard"
```

---

### Task 9: Full-suite verification + manual smoke

Confirm the whole refactor holds together and DataAnnotation behaves as before.

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all suites PASS (types, shared/diff, notify, data-annotation, registry, scheduler/window, crypto, health, expiry, format, settings-schema, middleware).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Manual smoke (local)**

Run: `npm run dev`, sign in, open the DataAnnotation job, and:
- Confirm the job page loads and shows recipients + history.
- Click **Run now**. Expected: a run row appears with a `summary` ("no change" or "+N projects, +N quals"); on a configured cookie a WhatsApp notification fires only when new items appear.
- Hit `GET /api/health?token=...`. Expected: `200`/`ok` with the `jobs[].slug` check present and cookie status reported (health field references unchanged in Phase 1).

- [ ] **Step 4: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "test: Phase 1 verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (Phase 1 portion of the spec):**
- §4.1 generic `run()`/`RunResult` → Task 1 ✓
- §4.2 diff-and-notify as opt-in helper → Task 2 (diff) + Task 3 (notify) + Task 5 (DataAnnotation opts in) ✓
- §4.3 `RunContext` with `recipients(tag)`, `lastSuccessful`, `notify` → Task 1 + Task 7 ✓
- §6 one global sender, per-job tagged recipients → Task 3 + Task 7 (tags), `fireExpiryWarning` tag ✓
- §8 schema: `jobs.type`, `recipients.tag`, `run_history` summary/data, backfill, existing-row data migration → Task 4 ✓
- §8 seeding keyed by type (Phase-1 retained) → Task 6 ✓
- §11 DataAnnotation retained (fetch/parse/format/settings/cookie-state) → Task 5 (logic preserved) ✓
- Deferred to later phases (correctly NOT in this plan): `scheduleType`/cron/interval (§5, Phase 2), `visibleToGuest` + roles + masking (§7, Phase 3), Split Console UI (§9, Phase 4), rename + cleanup (§10a/§10b, Phase 5).

**Placeholder scan:** No TBD/TODO; every code step shows full content; migration SQL is concrete; the only "search and fix" step (Task 8 Step 3) is driven by `tsc --noEmit` output with explicit replacement rules.

**Type consistency:** `JobModule.type`, `run()`, `RunResult{status,summary,data,errorMessage,rawHtml,notificationSent}`, `Recipient{id,name,phone,tag}`, `Notify(message,{tag})`, `getJob(type)`, `loadLastSuccessful → unknown`, `DaData.items` consumed via `ctx.lastSuccessful` — all consistent across Tasks 1, 3, 5, 6, 7. `rawHtml` column/field retained verbatim (spec §12 defers the `debug` rename).
