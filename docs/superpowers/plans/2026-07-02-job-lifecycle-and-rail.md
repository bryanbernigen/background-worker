# Rail UX + Job Lifecycle (Archive/Delete) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]` checkboxes. Load `frontend-design` for the rail/detail visual tasks (5, 6).

**Goal:** Fix the rail to fixed-height + searchable, and add archive (reversible) / permanent-delete (archived-only) job lifecycle.

**Architecture:** New nullable `jobs.archivedAt` gates scheduling and rail visibility. Archive/unarchive admin routes flip it and (un)schedule. The dashboard layout splits jobs into active/archived lists; the rail becomes a fixed-height flex column with a client-side search filter and a collapsible archived section. The job detail page gains lifecycle controls.

**Tech Stack:** Next.js 16 (RSC + routes), TypeScript, Drizzle, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-02-job-lifecycle-and-rail-design.md`.

## Global Constraints

- Archived jobs never run and never appear to guests. Enforcement is server-side.
- Permanent delete stays server-side (existing `DELETE`); UI only surfaces it on archived jobs.
- Migrations hand-authored (sql + snapshot + journal), validated with `drizzle-kit generate` → "No schema changes"; apply with `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts`.
- TDD for pure helpers; `tsc --noEmit` + `npm run build` + full suite green at the end.
- Commit per task; trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migration `0006_archive_jobs` + schema

**Files:** `lib/db/schema.ts`; `lib/db/migrations/0006_archive_jobs.sql`; `meta/0006_snapshot.json`; `meta/_journal.json`

- [ ] **Step 1: schema.ts** — in the `jobs` table, after `lastRunAt`, add:
```ts
  archivedAt:     timestamp('archived_at', { withTimezone: true }),
```

- [ ] **Step 2: sql** — `lib/db/migrations/0006_archive_jobs.sql`:
```sql
ALTER TABLE "jobs" ADD COLUMN "archived_at" timestamp with time zone;
```

- [ ] **Step 3: snapshot + journal** — copy `meta/0005_snapshot.json` → `0006_snapshot.json`; set `"id"` to a fresh UUID (`node -e "console.log(require('crypto').randomUUID())"`), `"prevId"` to the 0005 id (`2df10e32-93c6-4e96-b2e2-fac84e04f554`); in `tables."public.jobs".columns`, after `"last_run_at"`, add:
```json
        "archived_at": {
          "name": "archived_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
```
Append journal entry idx 6, tag `0006_archive_jobs`, `when` a fresh epoch-ms, version "7", breakpoints true.

- [ ] **Step 4: validate + apply**
Run: `npx drizzle-kit generate` → expect **"No schema changes, nothing to migrate"**.
Run: `npx tsx --env-file=.env --env-file=.env.local scripts/migrate.ts` → `migrations done`.

- [ ] **Step 5: commit**
```bash
git add lib/db/schema.ts lib/db/migrations/0006_archive_jobs.sql lib/db/migrations/meta/0006_snapshot.json lib/db/migrations/meta/_journal.json
git commit -m "feat(db): jobs.archivedAt (migration 0006)"
```

---

### Task 2: Scheduler — archived jobs never arm

**Files:** `lib/scheduler/index.ts`

- [ ] **Step 1: imports** — add `isNull` to the drizzle-orm import (currently `import { eq, desc, and } from 'drizzle-orm';`):
```ts
import { eq, desc, and, isNull } from 'drizzle-orm';
```

- [ ] **Step 2: `start()` arms only active jobs** — replace the two selects:
```ts
  const enabled = await db.select().from(jobs).where(and(eq(jobs.enabled, true), isNull(jobs.archivedAt)));
  for (const job of enabled) await armTimer(job.id);
  const all = await db.select({ id: jobs.id }).from(jobs).where(isNull(jobs.archivedAt));
  for (const job of all) await armExpiryTimer(job.id);
```

- [ ] **Step 3: `armTimer` guard** — change the disabled check to also cover archived:
```ts
  if (!job.enabled || job.archivedAt) {
    if (job.nextRunAt) {
      await db.update(jobs).set({ nextRunAt: null, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    }
    return;
  }
```

- [ ] **Step 4: `armExpiryTimer` guard** — after loading `job` (near `if (!job) return;`), add:
```ts
  if (job.archivedAt) return;
```

- [ ] **Step 5: typecheck + commit**
Run: `npx tsc --noEmit 2>&1 | grep -i "lib/scheduler" || echo clean` → `clean`.
```bash
git add lib/scheduler/index.ts
git commit -m "feat(scheduler): archived jobs are never armed"
```

---

### Task 3: Archive / unarchive routes + guest archived guard

**Files:** Create `app/api/jobs/[slug]/archive/route.ts`, `app/api/jobs/[slug]/unarchive/route.ts`; modify `app/api/jobs/[slug]/route.ts`, `.../recipients/route.ts`, `.../history/route.ts` (guest guard)

- [ ] **Step 1: archive route** — `app/api/jobs/[slug]/archive/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/access/role';
import { unschedule } from '@/lib/scheduler';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  unschedule(job.id);
  await db.update(jobs).set({ archivedAt: new Date(), nextRunAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: unarchive route** — `app/api/jobs/[slug]/unarchive/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/access/role';
import { reschedule } from '@/lib/scheduler';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  await db.update(jobs).set({ archivedAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
  await reschedule(job.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: guest archived guard in read routes** — in each of `app/api/jobs/[slug]/route.ts` (GET), `.../recipients/route.ts` (GET), `.../history/route.ts` (GET), change the guest visibility line from:
```ts
  if (role === 'guest' && !job.visibleToGuest) return NextResponse.json({ error: 'job not found' }, { status: 404 });
```
to:
```ts
  if (role === 'guest' && (!job.visibleToGuest || job.archivedAt)) return NextResponse.json({ error: 'job not found' }, { status: 404 });
```

- [ ] **Step 4: typecheck + commit**
Run: `npx tsc --noEmit 2>&1 | grep -iE "api/jobs" || echo clean` → `clean`.
```bash
git add "app/api/jobs/[slug]/archive/route.ts" "app/api/jobs/[slug]/unarchive/route.ts" "app/api/jobs/[slug]/route.ts" "app/api/jobs/[slug]/recipients/route.ts" "app/api/jobs/[slug]/history/route.ts"
git commit -m "feat(api): archive/unarchive routes; guests never see archived jobs"
```

---

### Task 4: `filterJobs` pure helper

**Files:** Create `lib/ui/filter-jobs.ts`, `lib/ui/filter-jobs.test.ts`

**Interfaces:** `filterJobs<T extends { title: string; type: string; slug: string }>(jobs: T[], query: string): T[]`

- [ ] **Step 1: failing test** — `lib/ui/filter-jobs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { filterJobs } from './filter-jobs';

const jobs = [
  { slug: 'da-main', title: 'Data Annotation', type: 'data-annotation' },
  { slug: 'scraper-2', title: 'Nightly Scraper', type: 'data-annotation' },
];

describe('filterJobs', () => {
  it('returns all for an empty query', () => {
    expect(filterJobs(jobs, '')).toHaveLength(2);
    expect(filterJobs(jobs, '   ')).toHaveLength(2);
  });
  it('matches title case-insensitively', () => {
    expect(filterJobs(jobs, 'nightly').map(j => j.slug)).toEqual(['scraper-2']);
  });
  it('matches slug and type', () => {
    expect(filterJobs(jobs, 'da-main').map(j => j.slug)).toEqual(['da-main']);
    expect(filterJobs(jobs, 'annotation')).toHaveLength(2);
  });
  it('returns none when nothing matches', () => {
    expect(filterJobs(jobs, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: run → fail** — `npx vitest run lib/ui/filter-jobs.test.ts`

- [ ] **Step 3: implement** — `lib/ui/filter-jobs.ts`:
```ts
export function filterJobs<T extends { title: string; type: string; slug: string }>(jobs: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return jobs;
  return jobs.filter(j =>
    j.title.toLowerCase().includes(q) ||
    j.type.toLowerCase().includes(q) ||
    j.slug.toLowerCase().includes(q));
}
```

- [ ] **Step 4: run → pass** — `npx vitest run lib/ui/filter-jobs.test.ts`

- [ ] **Step 5: commit**
```bash
git add lib/ui/filter-jobs.ts lib/ui/filter-jobs.test.ts
git commit -m "feat(ui): filterJobs helper for rail search"
```

---

### Task 5: Layout (fixed height + active/archived split) + Rail (search, scroll, archived section)

**Files:** `app/dashboard/layout.tsx`, `app/dashboard/rail.tsx`

- [ ] **Step 1: layout — imports + split query + h-screen shell.** Update the drizzle import to `import { desc, eq, and, isNull, isNotNull } from 'drizzle-orm';`. Replace the `rows`/`railJobs` block with active + archived lists, and change the shell height:
```ts
  const active = isAdmin
    ? await db.select().from(jobs).where(isNull(jobs.archivedAt))
    : await db.select().from(jobs).where(and(eq(jobs.visibleToGuest, true), isNull(jobs.archivedAt)));
  const archived = isAdmin
    ? await db.select().from(jobs).where(isNotNull(jobs.archivedAt))
    : [];

  const toRail = async (j: typeof active[number]) => ({
    slug: j.slug, title: j.title, type: j.type, scheduleType: j.scheduleType,
    visibleToGuest: j.visibleToGuest, status: await latestStatus(j.id),
  });
  const activeJobs = await Promise.all(active.map(toRail));
  const archivedJobs = await Promise.all(archived.map(toRail));
  const contactEnabled = !isAdmin && !!(await getAdminContactPhone()) && !!(await getWahaConfig()).url;

  return (
    <div className="h-screen overflow-hidden flex bg-bg text-text">
      <Rail active={activeJobs} archived={archivedJobs} isAdmin={isAdmin} contactEnabled={contactEnabled} />
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
```

- [ ] **Step 2: rewrite `app/dashboard/rail.tsx`** (search + internal scroll + archived section):
```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import StatusDot from '@/components/ui/status-dot';
import ContactAdmin from './contact-admin';
import { filterJobs } from '@/lib/ui/filter-jobs';

interface RailJob { slug: string; title: string; type: string; scheduleType: string; visibleToGuest: boolean; status: string }

function JobLink({ j, active, muted, isAdmin }: { j: RailJob; active: boolean; muted?: boolean; isAdmin: boolean }) {
  return (
    <Link href={`/dashboard/jobs/${j.slug}`}
      className={`flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2 ${active ? 'bg-surface-2 border-l-2 border-accent' : 'border-l-2 border-transparent'} ${muted ? 'opacity-60' : ''}`}>
      <StatusDot status={muted ? 'idle' : j.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{j.title}</span>
        <span className="block truncate text-[11px] font-mono uppercase tracking-wide text-muted">{j.type} · {j.scheduleType}</span>
      </span>
      {isAdmin && !j.visibleToGuest && !muted && <span title="Hidden from guests">🔒</span>}
    </Link>
  );
}

export default function Rail({ active, archived, isAdmin, contactEnabled }: {
  active: RailJob[]; archived: RailJob[]; isAdmin: boolean; contactEnabled: boolean;
}) {
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const shownActive = filterJobs(active, q);
  const shownArchived = filterJobs(archived, q);

  return (
    <aside className="w-72 shrink-0 h-full border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-4 flex items-center justify-between border-b border-border">
        <Link href="/dashboard" className="font-semibold tracking-tight">Background Worker</Link>
        {isAdmin && (
          <Link href="/dashboard/new" title="New job"
            className="w-7 h-7 grid place-items-center rounded border border-border text-accent hover:bg-surface-2">＋</Link>
        )}
      </div>

      <div className="px-3 py-2 border-b border-border">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search jobs…"
          className="w-full bg-surface-2 border border-border rounded px-2 py-1 text-sm placeholder:text-muted" />
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto py-2">
        <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-muted">Jobs</div>
        {shownActive.length === 0 && <div className="px-4 py-3 text-sm text-muted">{q ? 'No matches.' : 'No jobs yet.'}</div>}
        {shownActive.map(j => (
          <JobLink key={j.slug} j={j} active={pathname === `/dashboard/jobs/${j.slug}`} isAdmin={isAdmin} />
        ))}

        {isAdmin && archived.length > 0 && (
          <div className="mt-2 border-t border-border pt-1">
            <button onClick={() => setShowArchived(v => !v)}
              className="w-full px-4 py-1 text-left text-[10px] font-mono uppercase tracking-wider text-muted hover:text-text">
              {showArchived ? '▾' : '▸'} Archived ({archived.length})
            </button>
            {showArchived && shownArchived.map(j => (
              <JobLink key={j.slug} j={j} active={pathname === `/dashboard/jobs/${j.slug}`} muted isAdmin={isAdmin} />
            ))}
            {showArchived && shownArchived.length === 0 && <div className="px-4 py-2 text-xs text-muted">No matches.</div>}
          </div>
        )}
      </nav>

      {isAdmin && (
        <div className="border-t border-border py-2">
          <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-muted">Settings</div>
          <Link href="/dashboard/settings/notifications" className="block px-4 py-2 text-sm hover:bg-surface-2">Notifications</Link>
          <Link href="/dashboard/settings/access" className="block px-4 py-2 text-sm hover:bg-surface-2">Access</Link>
          <form action="/api/auth/logout" method="POST" className="px-4 py-2">
            <button className="text-xs text-muted hover:text-text">Logout</button>
          </form>
        </div>
      )}

      {contactEnabled && <div className="border-t border-border p-4"><ContactAdmin /></div>}
    </aside>
  );
}
```

- [ ] **Step 3: verify build** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`; `npm run build` compiles.

- [ ] **Step 4: commit**
```bash
git add app/dashboard/layout.tsx app/dashboard/rail.tsx
git commit -m "feat(ui): fixed-height rail with job search + collapsible archived section"
```

---

### Task 6: Job detail page — lifecycle controls + archived gating

**Files:** Create `app/dashboard/jobs/[slug]/lifecycle-controls.tsx`; modify `app/dashboard/jobs/[slug]/page.tsx`

- [ ] **Step 1: client controls** — `app/dashboard/jobs/[slug]/lifecycle-controls.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LifecycleControls({ slug, archived }: { slug: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const post = async (action: 'archive' | 'unarchive') => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/${action}`, { method: 'POST' });
    setBusy(false);
    if (res.ok) router.refresh();
    else setMsg(`Failed (${res.status})`);
  };

  const del = async () => {
    if (!confirm('Permanently delete this job and all its run history? This cannot be undone.')) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}`, { method: 'DELETE' });
    if (res.ok) { router.push('/dashboard'); return; }
    setBusy(false); setMsg(`Delete failed (${res.status})`);
  };

  return (
    <div className="flex items-center gap-2">
      {archived ? (
        <>
          <button disabled={busy} onClick={() => post('unarchive')}
            className="text-sm px-3 py-1.5 rounded bg-accent text-bg font-medium disabled:opacity-50">Unarchive</button>
          <button disabled={busy} onClick={del}
            className="text-sm px-3 py-1.5 rounded border border-error/40 text-error hover:bg-error/10 disabled:opacity-50">Delete permanently</button>
        </>
      ) : (
        <button disabled={busy} onClick={() => post('archive')}
          className="text-sm px-3 py-1.5 rounded border border-border text-muted hover:bg-surface-2 disabled:opacity-50">Archive</button>
      )}
      {msg && <span className="text-sm text-error">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 2: page — guest guard + archived rendering.** In `app/dashboard/jobs/[slug]/page.tsx`:

Add the import: `import LifecycleControls from './lifecycle-controls';`

Change the guest guard line:
```ts
  if (!isAdmin && (!job.visibleToGuest || job.archivedAt)) return notFound();
```
Add `const archived = !!job.archivedAt;` after it.

Replace the header block so an archived job shows a badge + unarchive/delete and hides run/schedule controls. Replace the current header + actions + schedule/panel region:
```tsx
      {isAdmin ? (
        <div className="flex items-start justify-between gap-3">
          <EditableHeader slug={slug} initial={{ title: job.title, url: job.url, description: job.description }} />
          {archived
            ? <span className="text-[11px] font-mono uppercase tracking-wider text-warn shrink-0">archived</span>
            : null}
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <p className="text-sm text-muted">{job.description}</p>
        </div>
      )}

      {isAdmin && archived && <LifecycleControls slug={slug} archived />}

      {!archived && (
        <>
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
                <LifecycleControls slug={slug} archived={false} />
              </div>
            )}
          </div>

          {isAdmin && (
            <ScheduleForm slug={slug} initial={{
              scheduleType: job.scheduleType, minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
              dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
              intervalS: job.intervalS, cronExpr: job.cronExpr,
            }} />
          )}
          {isAdmin && Panel && <Panel jobId={job.id} slug={slug} current={customForPanel} />}
        </>
      )}

      <RecipientsPanel slug={slug} tag="new-task" title="WhatsApp recipients (new-task alerts)" admin={isAdmin && !archived} />
      <RecipientsPanel slug={slug} tag="cookie-expiry" title="Cookie-expiry alert recipients" admin={isAdmin && !archived} />
      <HistoryTable slug={slug} />
```
(The existing block from `{isAdmin ? (<EditableHeader … ) : (…)}` through the two `RecipientsPanel` + `HistoryTable` is replaced by the above. Recipients become read-only for archived jobs by passing `admin={isAdmin && !archived}`.)

- [ ] **Step 3: verify build** — `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`; `npm run build` compiles.

- [ ] **Step 4: commit**
```bash
git add "app/dashboard/jobs/[slug]/lifecycle-controls.tsx" "app/dashboard/jobs/[slug]/page.tsx"
git commit -m "feat(ui): archive/unarchive/delete controls on the job page"
```

---

### Task 7: Full verification + manual smoke

- [ ] **Step 1:** `npx vitest run` (all pass, incl. `filterJobs`), `npx tsc --noEmit` (0), `npm run build` (compiles).
- [ ] **Step 2 (manual, Docker DB + dev):** archive an active job → it leaves the active list, appears under **Archived (N)**, stops running (no countdown); open it → Unarchive + Delete; **Unarchive** → returns to active + re-arms; **Delete permanently** (on an archived job) → confirm → gone. Type in the rail **search** → both lists filter. Open a job and scroll its detail → the rail **Settings/Logout stay pinned** and the jobs list scrolls on its own.
- [ ] **Step 3:** final commit if fixes were needed.

---

## Self-Review

**Spec coverage:** §3 `archivedAt` migration → Task 1; §4 scheduler guards → Task 2; §5 archive/unarchive routes + guest guard → Task 3; §6 rail search/scroll/archived → Tasks 4, 5; §7 layout h-screen + split → Task 5; §8 job page controls + gating → Task 6; §9 testing → Tasks 4, 7. ✓

**Placeholder scan:** full code for new files (migration, routes, `filter-jobs`, `lifecycle-controls`, rail); precise before/after for scheduler/layout/page. No TBD.

**Type consistency:** `RailJob` shape produced by layout's `toRail` matches Rail's prop type and `filterJobs`'s `{title,type,slug}` constraint. Archive/unarchive routes use `unschedule`/`reschedule` (existing exports). `CustomSettingsPanel` still gets `{jobId, slug, current}` (unchanged). `job.archivedAt` (Drizzle `Date | null`) drives the guest guard, scheduler guards, and page branching consistently.
