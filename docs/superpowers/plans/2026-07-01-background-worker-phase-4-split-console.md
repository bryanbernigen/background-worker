# Background Worker — Phase 4: Split Console UI + Dark Theme

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Also load `frontend-design`** for the visual tasks (2, 3, 5, 6, 7, 8, 9, 10) — this plan fixes structure, tokens, and behavior; that skill guides the aesthetic craft.

**Goal:** Recast the app as a dark "Split Console" (persistent rail + detail pane), add the admin submit-a-job UI and Settings (Notifications, Access), all role-aware over the existing Phase 1–3 APIs.

**Architecture:** A `app/dashboard/layout.tsx` server component resolves role, renders a left `Rail` (role-filtered jobs + admin extras) and the routed page as the right detail pane (`/dashboard` welcome, `/dashboard/jobs/[slug]`, `/dashboard/new`, `/dashboard/settings/*`). Dark theme via CSS vars + Tailwind v4 `@theme`. Testable logic (schedule field↔payload mapping, status→color) lives in pure `lib/ui/*` modules with unit tests; visual work is verified by `npm run build` + a manual pass.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, Tailwind CSS v4, Vitest. Read `node_modules/next/dist/docs/` before touching Next-specific code per `AGENTS.md`.

**Spec:** `docs/superpowers/specs/2026-07-01-background-worker-phase-4-design.md`.

## Global Constraints

- Next.js is a modified build — read the relevant guide under `node_modules/next/dist/docs/` before writing Next code (`AGENTS.md`).
- Dark palette (exact): `--color-bg #0e0f13`, `--color-surface #16181f`, `--color-surface-2 #1d2029`, `--color-border #2a2e3a`, `--color-text #e7e9ee`, `--color-muted #9aa3b2`, `--color-accent #22d3ee`; status `--color-ok #34d399`, `--color-warn #fbbf24`, `--color-error #f87171`, `--color-off #52525b`. Inter body, `font-mono` uppercase micro-labels.
- All access enforcement is server-side (Phase 3). UI only *hides* controls guests can't use; never the sole guard. Reuse `resolveRole()` from `@/lib/access/role`.
- No new backend endpoints except one small admin "send test" route (Task 10).
- TDD for pure logic (`lib/ui/*`): failing test → fail → implement → pass → commit. Vitest: `npx vitest run <path>`.
- Visual tasks are verified by `npx tsc --noEmit` + `npm run build` + a manual pass; they still end in a commit.
- End of phase: full suite + `tsc --noEmit` + `npm run build` green; admin + guest flows work; DataAnnotation behavior unchanged.
- Frequent commits: one per task. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Dark theme tokens

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Replace `app/globals.css` with the dark token set**

```css
@import "tailwindcss";

:root {
  --color-bg: #0e0f13;
  --color-surface: #16181f;
  --color-surface-2: #1d2029;
  --color-border: #2a2e3a;
  --color-text: #e7e9ee;
  --color-muted: #9aa3b2;
  --color-accent: #22d3ee;
  --color-ok: #34d399;
  --color-warn: #fbbf24;
  --color-error: #f87171;
  --color-off: #52525b;
}

@theme inline {
  --color-bg: var(--color-bg);
  --color-surface: var(--color-surface);
  --color-surface-2: var(--color-surface-2);
  --color-border: var(--color-border);
  --color-text: var(--color-text);
  --color-muted: var(--color-muted);
  --color-accent: var(--color-accent);
  --color-ok: var(--color-ok);
  --color-warn: var(--color-warn);
  --color-error: var(--color-error);
  --color-off: var(--color-off);
  --font-sans: var(--font-inter);
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}
```

These expose Tailwind utilities like `bg-surface`, `text-muted`, `border-border`, `text-accent`, `bg-ok`, etc.

- [ ] **Step 2: Update `app/layout.tsx` metadata title**

Change the metadata title to the console name (kept generic; project rename is Phase 5):

```ts
export const metadata: Metadata = {
  title: "Background Worker",
  description: "Job runtime console",
};
```

(Leave the Inter font wiring as-is; `font-mono` uses Tailwind's default mono stack.)

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds. (Pages still use light-theme utility classes — they get restyled in later tasks; the app remains functional.)

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat(ui): dark theme design tokens (portfolio palette)"
```

---

### Task 2: Status color helper + StatusDot + UI primitives

**Files:**
- Create: `lib/ui/status.ts`, `lib/ui/status.test.ts`
- Create: `components/ui/status-dot.tsx`
- Modify: `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/badge.tsx`, `components/ui/input.tsx`

**Interfaces:**
- Produces: `statusColorVar(status: string): string` (CSS `var(--color-*)`); `<StatusDot status={string} />`.

- [ ] **Step 1: Write the failing test**

Create `lib/ui/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { statusColorVar } from './status';

describe('statusColorVar', () => {
  it('maps known statuses', () => {
    expect(statusColorVar('ok')).toBe('var(--color-ok)');
    expect(statusColorVar('error')).toBe('var(--color-error)');
    expect(statusColorVar('skipped')).toBe('var(--color-warn)');
  });
  it('falls back to off for idle/unknown', () => {
    expect(statusColorVar('idle')).toBe('var(--color-off)');
    expect(statusColorVar('whatever')).toBe('var(--color-off)');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/ui/status.test.ts`
Expected: FAIL — `./status` missing.

- [ ] **Step 3: Implement `lib/ui/status.ts`**

```ts
export function statusColorVar(status: string): string {
  switch (status) {
    case 'ok':      return 'var(--color-ok)';
    case 'error':   return 'var(--color-error)';
    case 'skipped': return 'var(--color-warn)';
    default:        return 'var(--color-off)';
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/ui/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `components/ui/status-dot.tsx`**

```tsx
import { statusColorVar } from '@/lib/ui/status';

export default function StatusDot({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${className}`}
      style={{ backgroundColor: statusColorVar(status) }}
      aria-label={status}
    />
  );
}
```

- [ ] **Step 6: Restyle the UI primitives to dark tokens**

`components/ui/button.tsx` — keep the API; default to accent styling:

```tsx
export default function Button({ children, onClick, className = '', type = 'button', disabled = false }: {
  children: React.ReactNode; onClick?: () => void; className?: string; type?: 'button' | 'submit'; disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-md font-medium transition-colors bg-accent text-bg hover:opacity-90 ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}
```

`components/ui/card.tsx` — surface bg + border. Open the file and set its container classes to `bg-surface border border-border rounded-lg` (keep the existing `className` passthrough and `!p-0` support). `components/ui/input.tsx` — `bg-surface-2 border border-border text-text placeholder:text-muted rounded px-2 py-1`. `components/ui/badge.tsx` — map its color prop to token backgrounds (`green→bg-ok/20 text-ok`, `red→bg-error/20 text-error`, `orange→bg-warn/20 text-warn`, `gray→bg-off/20 text-muted`), preserving the `color` prop contract. Read each file first and restyle in place, keeping props/exports identical.

- [ ] **Step 7: Verify + commit**

Run: `npx vitest run lib/ui/status.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

```bash
git add lib/ui/status.ts lib/ui/status.test.ts components/ui
git commit -m "feat(ui): StatusDot + status color helper; dark-theme primitives"
```

---

### Task 3: Login page dark restyle

**Files:**
- Modify: `app/page.tsx`, `components/login-form.tsx`

- [ ] **Step 1: Restyle the login page background**

In `app/page.tsx`, swap the light background:

```tsx
'use client';
import LoginForm from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg">
      <LoginForm />
    </main>
  );
}
```

- [ ] **Step 2: Restyle `components/login-form.tsx`**

Read the file, then restyle its container + inputs + button to the dark tokens (`bg-surface border border-border` card; `bg-surface-2 border-border text-text` inputs; accent submit button; `text-muted` labels; `text-error` error text). Keep all form logic, field names, and the POST target unchanged.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds. Manually confirm the login page renders dark (note it for the human).

```bash
git add app/page.tsx components/login-form.tsx
git commit -m "feat(ui): dark-theme login page"
```

---

### Task 4: Schedule field mapping module

Pure state↔payload mapping shared by `/dashboard/new` and `schedule-form`.

**Files:**
- Create: `lib/ui/schedule-fields.ts`, `lib/ui/schedule-fields.test.ts`

**Interfaces:**
- Consumes: `ScheduleType` from `@/lib/scheduler/window`.
- Produces:
  - `interface ScheduleFieldsState { scheduleType: ScheduleType; minIntervalS; maxIntervalS; dayStartHour; dayEndHour; tzOffsetH; intervalS; cronExpr }` (all numbers except `scheduleType` and `cronExpr: string`)
  - `DEFAULT_SCHEDULE_FIELDS: ScheduleFieldsState`
  - `scheduleFieldsToPayload(s)` → the discriminated `schedule` object for `POST /api/jobs`
  - `scheduleFieldsToSettings(s)` → flat `schedule` object for the settings PATCH
  - `scheduleFieldsFromJob(job)` → seed state from a job row

- [ ] **Step 1: Write the failing test**

Create `lib/ui/schedule-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCHEDULE_FIELDS, scheduleFieldsToPayload, scheduleFieldsToSettings, scheduleFieldsFromJob,
} from './schedule-fields';

describe('scheduleFieldsToPayload', () => {
  it('window', () => {
    expect(scheduleFieldsToPayload({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'window' }))
      .toEqual({ type: 'window', minIntervalS: 600, maxIntervalS: 1800, dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7 });
  });
  it('interval', () => {
    expect(scheduleFieldsToPayload({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'interval', intervalS: 300 }))
      .toEqual({ type: 'interval', intervalS: 300 });
  });
  it('cron', () => {
    expect(scheduleFieldsToPayload({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'cron', cronExpr: '0 9 * * *', tzOffsetH: 7 }))
      .toEqual({ type: 'cron', cronExpr: '0 9 * * *', tzOffsetH: 7 });
  });
});

describe('scheduleFieldsToSettings', () => {
  it('interval nulls cron', () => {
    expect(scheduleFieldsToSettings({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'interval', intervalS: 120 }))
      .toMatchObject({ scheduleType: 'interval', intervalS: 120, cronExpr: null });
  });
  it('cron nulls interval', () => {
    expect(scheduleFieldsToSettings({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'cron', cronExpr: '*/5 * * * *' }))
      .toMatchObject({ scheduleType: 'cron', cronExpr: '*/5 * * * *', intervalS: null });
  });
});

describe('scheduleFieldsFromJob', () => {
  it('seeds defaults for null interval/cron', () => {
    const s = scheduleFieldsFromJob({
      scheduleType: 'window', minIntervalS: 600, maxIntervalS: 1800,
      dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7, intervalS: null, cronExpr: null,
    });
    expect(s.scheduleType).toBe('window');
    expect(s.intervalS).toBe(300);
    expect(s.cronExpr).toBe('0 9 * * *');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/ui/schedule-fields.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/ui/schedule-fields.ts`**

```ts
import type { ScheduleType } from '@/lib/scheduler/window';

export interface ScheduleFieldsState {
  scheduleType: ScheduleType;
  minIntervalS: number;
  maxIntervalS: number;
  dayStartHour: number;
  dayEndHour: number;
  tzOffsetH: number;
  intervalS: number;
  cronExpr: string;
}

export const DEFAULT_SCHEDULE_FIELDS: ScheduleFieldsState = {
  scheduleType: 'window',
  minIntervalS: 600, maxIntervalS: 1800,
  dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7,
  intervalS: 300, cronExpr: '0 9 * * *',
};

export type SchedulePayload =
  | { type: 'window'; minIntervalS: number; maxIntervalS: number; dayStartHour: number; dayEndHour: number; tzOffsetH: number }
  | { type: 'interval'; intervalS: number }
  | { type: 'cron'; cronExpr: string; tzOffsetH: number };

export function scheduleFieldsToPayload(s: ScheduleFieldsState): SchedulePayload {
  if (s.scheduleType === 'interval') return { type: 'interval', intervalS: s.intervalS };
  if (s.scheduleType === 'cron') return { type: 'cron', cronExpr: s.cronExpr, tzOffsetH: s.tzOffsetH };
  return {
    type: 'window',
    minIntervalS: s.minIntervalS, maxIntervalS: s.maxIntervalS,
    dayStartHour: s.dayStartHour, dayEndHour: s.dayEndHour, tzOffsetH: s.tzOffsetH,
  };
}

export function scheduleFieldsToSettings(s: ScheduleFieldsState): Record<string, unknown> {
  const base = { scheduleType: s.scheduleType, tzOffsetH: s.tzOffsetH };
  if (s.scheduleType === 'interval') return { ...base, intervalS: s.intervalS, cronExpr: null };
  if (s.scheduleType === 'cron') return { ...base, cronExpr: s.cronExpr, intervalS: null };
  return {
    ...base,
    minIntervalS: s.minIntervalS, maxIntervalS: s.maxIntervalS,
    dayStartHour: s.dayStartHour, dayEndHour: s.dayEndHour,
  };
}

export function scheduleFieldsFromJob(job: {
  scheduleType: string; minIntervalS: number; maxIntervalS: number;
  dayStartHour: number; dayEndHour: number; tzOffsetH: number;
  intervalS: number | null; cronExpr: string | null;
}): ScheduleFieldsState {
  return {
    scheduleType: job.scheduleType as ScheduleType,
    minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
    dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
    intervalS: job.intervalS ?? DEFAULT_SCHEDULE_FIELDS.intervalS,
    cronExpr: job.cronExpr ?? DEFAULT_SCHEDULE_FIELDS.cronExpr,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/ui/schedule-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/schedule-fields.ts lib/ui/schedule-fields.test.ts
git commit -m "feat(ui): pure schedule field <-> payload mapping"
```

---

### Task 5: Console shell — dashboard layout + rail

**Files:**
- Create: `app/dashboard/layout.tsx`, `app/dashboard/rail.tsx`

**Interfaces:**
- Consumes: `resolveRole` (`@/lib/access/role`), `getAdminContactPhone` (`@/lib/access/settings`), `jobs`/`runHistory` schema, `StatusDot` (Task 2), `ContactAdmin` (`./contact-admin`).

- [ ] **Step 1: Create `app/dashboard/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { resolveRole } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import Rail from './rail';

async function latestStatus(jobId: number): Promise<string> {
  const [row] = await db.select({ status: runHistory.status, startedAt: runHistory.startedAt })
    .from(runHistory).where(eq(runHistory.jobId, jobId))
    .orderBy(desc(runHistory.startedAt)).limit(1);
  return row?.status ?? 'idle';
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const role = await resolveRole();
  if (!role) redirect('/');
  const isAdmin = role === 'admin';

  const rows = isAdmin
    ? await db.select().from(jobs)
    : await db.select().from(jobs).where(eq(jobs.visibleToGuest, true));
  const railJobs = await Promise.all(rows.map(async j => ({
    slug: j.slug, title: j.title, type: j.type, scheduleType: j.scheduleType,
    visibleToGuest: j.visibleToGuest, status: await latestStatus(j.id),
  })));
  const contactEnabled = !isAdmin && !!(await getAdminContactPhone()) && !!process.env.WAHA_URL;

  return (
    <div className="min-h-screen flex bg-bg text-text">
      <Rail jobs={railJobs} isAdmin={isAdmin} contactEnabled={contactEnabled} />
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/dashboard/rail.tsx`**

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import StatusDot from '@/components/ui/status-dot';
import ContactAdmin from './contact-admin';

interface RailJob { slug: string; title: string; type: string; scheduleType: string; visibleToGuest: boolean; status: string }

export default function Rail({ jobs, isAdmin, contactEnabled }: { jobs: RailJob[]; isAdmin: boolean; contactEnabled: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="w-72 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-4 py-4 flex items-center justify-between border-b border-border">
        <Link href="/dashboard" className="font-semibold tracking-tight">Background Worker</Link>
        {isAdmin && (
          <Link href="/dashboard/new" title="New job"
            className="w-7 h-7 grid place-items-center rounded border border-border text-accent hover:bg-surface-2">＋</Link>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-muted">Jobs</div>
        {jobs.length === 0 && <div className="px-4 py-3 text-sm text-muted">No jobs yet.</div>}
        {jobs.map(j => {
          const active = pathname === `/dashboard/jobs/${j.slug}`;
          return (
            <Link key={j.slug} href={`/dashboard/jobs/${j.slug}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2 ${active ? 'bg-surface-2 border-l-2 border-accent' : 'border-l-2 border-transparent'}`}>
              <StatusDot status={j.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{j.title}</span>
                <span className="block truncate text-[11px] font-mono uppercase tracking-wide text-muted">{j.type} · {j.scheduleType}</span>
              </span>
              {isAdmin && !j.visibleToGuest && <span title="Hidden from guests">🔒</span>}
            </Link>
          );
        })}
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

      {contactEnabled && (
        <div className="border-t border-border p-4"><ContactAdmin /></div>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds. (`/dashboard` and job pages now render inside the rail shell; their own outer wrappers are trimmed in Tasks 6–7.)

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/layout.tsx app/dashboard/rail.tsx
git commit -m "feat(ui): split-console shell (dashboard layout + rail)"
```

---

### Task 6: Welcome pane (`/dashboard`)

Strip the old job grid (now in the rail); make `/dashboard` the welcome/landing detail pane with intro + Services + build footer.

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Replace `app/dashboard/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { externalServices, GITHUB_REPO_URL } from '@/lib/services';

export default async function DashboardHome() {
  const role = await resolveRole();
  if (!role) redirect('/');

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Background Worker</h1>
        <p className="text-muted mt-1">A 24/7 job runtime. Pick a job from the rail to inspect its runs, schedule, and recipients.</p>
      </div>

      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">Services &amp; Accounts</h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface overflow-hidden">
          {externalServices.map(svc => (
            <li key={svc.name}>
              <a href={svc.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-2 transition-colors group">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-1.5">
                    {svc.name}
                    <span className="text-muted group-hover:text-accent transition-colors" aria-hidden>↗</span>
                  </div>
                  {svc.note && <div className="text-sm text-muted truncate">{svc.note}</div>}
                </div>
                <span className="shrink-0 text-xs px-2 py-1 rounded bg-surface-2 text-muted">{svc.account}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <BuildFooter />
    </div>
  );
}

function BuildFooter() {
  const commit = process.env.GIT_COMMIT;
  if (!commit || commit === 'unknown') {
    return <footer className="text-center text-xs text-muted">Background Worker</footer>;
  }
  return (
    <footer className="text-center text-xs text-muted">
      running{' '}
      <a href={`${GITHUB_REPO_URL}/commit/${commit}`} target="_blank" rel="noopener noreferrer"
        className="font-mono text-muted hover:text-accent hover:underline">{commit}</a>
    </footer>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds (no more references to the removed `jobs`/`runHistory`/`Card`/`Badge` imports in this file).

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(ui): welcome pane at /dashboard (intro + services)"
```

---

### Task 7: Job detail pane restyle + schedule-form scheduleType

**Files:**
- Modify: `app/dashboard/jobs/[slug]/page.tsx` (trim outer wrapper; dark classes)
- Modify: `app/dashboard/jobs/[slug]/schedule-form.tsx` (add scheduleType selector; use Task 4 mapping; dark restyle)
- Modify: `app/dashboard/jobs/[slug]/{recipients-panel,history-table}.tsx` (dark restyle; `StatusDot` in history)

**Interfaces:**
- Consumes: `scheduleFieldsFromJob`/`scheduleFieldsToSettings`/`ScheduleFieldsState` (Task 4), `StatusDot` (Task 2).

- [ ] **Step 1: Trim the job page's outer wrapper**

In `app/dashboard/jobs/[slug]/page.tsx`, the page now renders inside the console layout, so replace the outer `<div className="min-h-screen bg-gray-50 p-8"><div className="max-w-6xl mx-auto space-y-6">` wrapper with a pane wrapper (keep all inner content + role gating from Phase 3):

```tsx
  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
```

and close with the matching single `</div>`. Pass the job's schedule fields into `ScheduleForm` (replace its `initial` prop wiring):

```tsx
        {isAdmin && (
          <ScheduleForm slug={slug} initial={{
            scheduleType: job.scheduleType, minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
            dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
            intervalS: job.intervalS, cronExpr: job.cronExpr,
          }} />
        )}
```

- [ ] **Step 2: Rewrite `schedule-form.tsx` for all three schedule types**

```tsx
'use client';
import { useState } from 'react';
import { formatDurationS } from '@/lib/format-duration';
import {
  scheduleFieldsFromJob, scheduleFieldsToSettings, type ScheduleFieldsState,
} from '@/lib/ui/schedule-fields';

interface Initial {
  scheduleType: string; minIntervalS: number; maxIntervalS: number;
  dayStartHour: number; dayEndHour: number; tzOffsetH: number;
  intervalS: number | null; cronExpr: string | null;
}

export default function ScheduleForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [s, setS] = useState<ScheduleFieldsState>(scheduleFieldsFromJob(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${slug}/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: scheduleFieldsToSettings(s) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error: ${JSON.stringify(body.error ?? res.status)}`);
  };

  const set = (patch: Partial<ScheduleFieldsState>) => setS({ ...s, ...patch });

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-surface">
      <h3 className="font-semibold">Schedule</h3>
      <label className="block text-sm">
        <span className="text-muted">Type</span>
        <select value={s.scheduleType} onChange={e => set({ scheduleType: e.target.value as ScheduleFieldsState['scheduleType'] })}
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1">
          <option value="window">Randomized window</option>
          <option value="interval">Fixed interval</option>
          <option value="cron">Cron</option>
        </select>
      </label>

      {s.scheduleType === 'window' && (
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Min interval" suffix="sec" hint={formatDurationS(s.minIntervalS)} value={s.minIntervalS} onChange={v => set({ minIntervalS: v })} />
          <NumField label="Max interval" suffix="sec" hint={formatDurationS(s.maxIntervalS)} value={s.maxIntervalS} onChange={v => set({ maxIntervalS: v })} />
          <NumField label="Active from" suffix="hour" hint={`${pad(s.dayStartHour)}:00 local`} value={s.dayStartHour} onChange={v => set({ dayStartHour: v })} />
          <NumField label="Active to (excl.)" suffix="hour" hint={`${pad(s.dayEndHour)}:00 local`} value={s.dayEndHour} onChange={v => set({ dayEndHour: v })} />
          <NumField label="Timezone offset" suffix="hours" hint={`UTC${s.tzOffsetH >= 0 ? '+' : ''}${s.tzOffsetH}`} value={s.tzOffsetH} onChange={v => set({ tzOffsetH: v })} />
        </div>
      )}
      {s.scheduleType === 'interval' && (
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Interval" suffix="sec" hint={formatDurationS(s.intervalS)} value={s.intervalS} onChange={v => set({ intervalS: v })} />
        </div>
      )}
      {s.scheduleType === 'cron' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2">
            <span className="text-sm text-muted">Cron expression</span>
            <input className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono"
              value={s.cronExpr} onChange={e => set({ cronExpr: e.target.value })} placeholder="0 9 * * *" />
          </label>
          <NumField label="Timezone offset" suffix="hours" hint={`UTC${s.tzOffsetH >= 0 ? '+' : ''}${s.tzOffsetH}`} value={s.tzOffsetH} onChange={v => set({ tzOffsetH: v })} />
        </div>
      )}

      <button disabled={busy} onClick={save} className="px-3 py-1.5 rounded bg-accent text-bg disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm text-muted">{msg}</span>}
    </div>
  );
}

function NumField({ label, suffix, hint, value, onChange }: {
  label: string; suffix: string; hint: string; value: number; onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" className="flex-1 bg-surface-2 border border-border rounded p-2"
          value={value} onChange={e => onChange(Number(e.target.value))} />
        <span className="text-xs text-muted">{suffix}</span>
      </div>
      <div className="text-xs text-muted mt-0.5">≈ {hint}</div>
    </label>
  );
}

function pad(n: number): string { return n.toString().padStart(2, '0'); }
```

- [ ] **Step 3: Dark-restyle recipients-panel + history-table**

Read each file and replace the light utility classes (`bg-white`, `border`, `text-gray-*`, `bg-gray-50`) with dark tokens (`bg-surface`, `border-border`, `text-muted`, `bg-surface-2`), keeping all logic/props. In `history-table.tsx`, replace the inline `StatusDot` local function usage with the shared `import StatusDot from '@/components/ui/status-dot'` (delete the local `StatusDot`, keep `statusTextColor` or switch text color to tokens). Keep the `admin` prop behavior from Phase 3.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds. Manually confirm the job page renders in the pane with a working schedule-type switcher.

- [ ] **Step 5: Commit**

```bash
git add "app/dashboard/jobs/[slug]"
git commit -m "feat(ui): job detail pane restyle + schedule-type editing"
```

---

### Task 8: Submit-a-job (`/dashboard/new`)

**Files:**
- Create: `app/dashboard/new/page.tsx`, `app/dashboard/new/new-job-form.tsx`

**Interfaces:**
- Consumes: `resolveRole` (admin gate), `listJobTypes` (`@/lib/jobs/registry`), `DEFAULT_SCHEDULE_FIELDS`/`scheduleFieldsToPayload`/`ScheduleFieldsState` (Task 4).

- [ ] **Step 1: Create `app/dashboard/new/page.tsx` (server, admin-gated)**

```tsx
import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { listJobTypes } from '@/lib/jobs/registry';
import NewJobForm from './new-job-form';

export default async function NewJobPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const types = listJobTypes().map(t => ({ type: t.type, title: t.defaultMeta.title }));
  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">New job</h1>
      <NewJobForm types={types} />
    </div>
  );
}
```

- [ ] **Step 2: Create `app/dashboard/new/new-job-form.tsx` (client)**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_SCHEDULE_FIELDS, scheduleFieldsToPayload, type ScheduleFieldsState } from '@/lib/ui/schedule-fields';

interface TypeOption { type: string; title: string }

export default function NewJobForm({ types }: { types: TypeOption[] }) {
  const router = useRouter();
  const [type, setType] = useState(types[0]?.type ?? '');
  const [name, setName] = useState('');
  const [visibleToGuest, setVisibleToGuest] = useState(true);
  const [sched, setSched] = useState<ScheduleFieldsState>(DEFAULT_SCHEDULE_FIELDS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setS = (patch: Partial<ScheduleFieldsState>) => setSched({ ...sched, ...patch });

  const submit = async () => {
    setBusy(true); setErr(null);
    const res = await fetch('/api/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, name, visibleToGuest, schedule: scheduleFieldsToPayload(sched) }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { router.push(`/dashboard/jobs/${body.job.slug}`); return; }
    setBusy(false);
    setErr(typeof body.error === 'string' ? body.error : JSON.stringify(body.error ?? res.status));
  };

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-surface">
      <label className="block text-sm">
        <span className="text-muted">Type</span>
        <select value={type} onChange={e => setType(e.target.value)} className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1">
          {types.map(t => <option key={t.type} value={t.type}>{t.title}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-muted">Name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. DataAnnotation (main)"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1" />
      </label>

      <label className="block text-sm">
        <span className="text-muted">Schedule type</span>
        <select value={sched.scheduleType} onChange={e => setS({ scheduleType: e.target.value as ScheduleFieldsState['scheduleType'] })}
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1">
          <option value="window">Randomized window</option>
          <option value="interval">Fixed interval</option>
          <option value="cron">Cron</option>
        </select>
      </label>

      {sched.scheduleType === 'window' && (
        <div className="grid grid-cols-2 gap-3">
          <Num label="Min interval (s)" value={sched.minIntervalS} onChange={v => setS({ minIntervalS: v })} />
          <Num label="Max interval (s)" value={sched.maxIntervalS} onChange={v => setS({ maxIntervalS: v })} />
          <Num label="Active from (h)" value={sched.dayStartHour} onChange={v => setS({ dayStartHour: v })} />
          <Num label="Active to (h, excl.)" value={sched.dayEndHour} onChange={v => setS({ dayEndHour: v })} />
          <Num label="TZ offset (h)" value={sched.tzOffsetH} onChange={v => setS({ tzOffsetH: v })} />
        </div>
      )}
      {sched.scheduleType === 'interval' && (
        <Num label="Interval (s)" value={sched.intervalS} onChange={v => setS({ intervalS: v })} />
      )}
      {sched.scheduleType === 'cron' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2 text-sm">
            <span className="text-muted">Cron expression</span>
            <input value={sched.cronExpr} onChange={e => setS({ cronExpr: e.target.value })} placeholder="0 9 * * *"
              className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
          </label>
          <Num label="TZ offset (h)" value={sched.tzOffsetH} onChange={v => setS({ tzOffsetH: v })} />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={visibleToGuest} onChange={e => setVisibleToGuest(e.target.checked)} />
        <span className="text-muted">Visible to guests</span>
      </label>

      <button disabled={busy || !type || !name} onClick={submit}
        className="px-3 py-1.5 rounded bg-accent text-bg disabled:opacity-50">
        {busy ? 'Creating…' : 'Create & start'}
      </button>
      {err && <div className="text-sm text-error">{err}</div>}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1" />
    </label>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds; `/dashboard/new` is present in the route list.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/new
git commit -m "feat(ui): submit-a-job form at /dashboard/new"
```

---

### Task 9: Settings — Access

**Files:**
- Create: `app/dashboard/settings/access/page.tsx`, `app/dashboard/settings/access/access-form.tsx`

**Interfaces:**
- Consumes: `resolveRole` (admin gate), `isGuestModeEnabled`/`getAdminContactPhone` (`@/lib/access/settings`); the client form calls `PATCH /api/settings/access` (Phase 3).

- [ ] **Step 1: Create `app/dashboard/settings/access/page.tsx` (server, admin)**

```tsx
import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { isGuestModeEnabled, getAdminContactPhone } from '@/lib/access/settings';
import AccessForm from './access-form';

export default async function AccessSettingsPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const guestMode = await isGuestModeEnabled();
  const adminContactPhone = await getAdminContactPhone();
  return (
    <div className="max-w-xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">Access</h1>
      <AccessForm initial={{ guestMode, adminContactPhone: adminContactPhone ?? '' }} />
    </div>
  );
}
```

- [ ] **Step 2: Create `app/dashboard/settings/access/access-form.tsx` (client)**

```tsx
'use client';
import { useState } from 'react';

export default function AccessForm({ initial }: { initial: { guestMode: boolean; adminContactPhone: string } }) {
  const [guestMode, setGuestMode] = useState(initial.guestMode);
  const [phone, setPhone] = useState(initial.adminContactPhone);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/settings/access', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestMode, adminContactPhone: phone.trim() || null }),
    });
    setBusy(false);
    setMsg(res.ok ? 'Saved' : `Error (${res.status})`);
  };

  return (
    <div className="space-y-4 border border-border rounded-lg p-4 bg-surface">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={guestMode} onChange={e => setGuestMode(e.target.checked)} />
        <span>Guest mode — allow public read-only access</span>
      </label>
      <label className="block text-sm">
        <span className="text-muted">Admin contact phone (WhatsApp) — receives access requests</span>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="628123456789"
          className="mt-1 block w-full bg-surface-2 border border-border rounded px-2 py-1 font-mono" />
      </label>
      <button disabled={busy} onClick={save} className="px-3 py-1.5 rounded bg-accent text-bg disabled:opacity-50">Save</button>
      {msg && <span className="ml-3 text-sm text-muted">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.

```bash
git add app/dashboard/settings/access
git commit -m "feat(ui): Access settings page (guest mode + contact phone)"
```

---

### Task 10: Settings — Notifications + send-test endpoint

**Files:**
- Create: `app/api/settings/notifications/test/route.ts` (admin; the phase's only backend addition)
- Create: `app/dashboard/settings/notifications/page.tsx`, `app/dashboard/settings/notifications/test-button.tsx`

**Interfaces:**
- Consumes: `requireAdmin` (`@/lib/access/role`), `getAdminContactPhone` (`@/lib/access/settings`), `wahaChannelFromEnv` (`@/lib/notify`).

- [ ] **Step 1: Create the send-test route**

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import { wahaChannelFromEnv } from '@/lib/notify';

export async function POST() {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const phone = await getAdminContactPhone();
  const channel = wahaChannelFromEnv();
  if (!phone || !channel) return NextResponse.json({ error: 'Set an admin contact phone and configure WAHA first.' }, { status: 400 });
  let sent = false;
  try { sent = await channel.sendText(phone, '✅ Test message from Background Worker'); }
  catch (e) { console.error('[notifications] test send failed', e); }
  return sent ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Delivery failed' }, { status: 502 });
}
```

- [ ] **Step 2: Create the Notifications page (server, admin)**

```tsx
import { notFound } from 'next/navigation';
import { resolveRole } from '@/lib/access/role';
import { getAdminContactPhone } from '@/lib/access/settings';
import TestButton from './test-button';

export default async function NotificationsSettingsPage() {
  const role = await resolveRole();
  if (role !== 'admin') return notFound();
  const wahaConfigured = !!process.env.WAHA_URL;
  const phone = await getAdminContactPhone();

  return (
    <div className="max-w-xl mx-auto p-8 space-y-6">
      <a href="/dashboard" className="text-sm text-muted hover:text-text">← Console</a>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <div className="space-y-3 border border-border rounded-lg p-4 bg-surface text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">WhatsApp sender (WAHA)</span>
          <span className={wahaConfigured ? 'text-ok' : 'text-off'}>{wahaConfigured ? 'configured' : 'not configured'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Admin contact phone</span>
          <span className="font-mono">{phone ?? '—'}</span>
        </div>
        <p className="text-muted">If messages stop sending, the WAHA session may need a QR re-scan on the WAHA host.</p>
        <TestButton disabled={!wahaConfigured || !phone} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the test button (client)**

```tsx
'use client';
import { useState } from 'react';

export default function TestButton({ disabled }: { disabled: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/settings/notifications/test', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? 'Test sent ✓' : (body.error ?? `Failed (${res.status})`));
  };
  return (
    <div>
      <button disabled={disabled || busy} onClick={send}
        className="px-3 py-1.5 rounded bg-accent text-bg disabled:opacity-50">
        {busy ? 'Sending…' : 'Send test'}
      </button>
      {msg && <span className="ml-3 text-muted">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds; `/api/settings/notifications/test` + `/dashboard/settings/notifications` present.

```bash
git add app/api/settings/notifications app/dashboard/settings/notifications
git commit -m "feat(ui): Notifications settings + send-test endpoint"
```

---

### Task 11: Full verification + manual pass

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS (existing + new `lib/ui/*`); no type errors; build succeeds.

- [ ] **Step 2: Manual pass (Docker DB + dev server)**

`npm run dev`, then eyeball the dark console:
- **Admin:** rail lists jobs with status dots; open a job → detail pane restyled, schedule-type switcher works (save a cron/interval and confirm the countdown re-arms); `＋ New job` → create an interval instance → redirected to it, appears in rail; Settings → Access (toggle guest mode, set phone) and Notifications (status + Send test); Logout in rail.
- **Guest (private window):** rail shows only visible jobs, no `＋`/Settings, masked recipients, read-only; "Request full access" in the rail footer submits.
- Confirm DataAnnotation still runs (a manual Run now produces a `summary` row).

- [ ] **Step 3: Final commit (if fixes needed)**

```bash
git add -A && git commit -m "test: Phase 4 verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §3 dark theme tokens + primitives + login → Tasks 1, 2, 3 ✓
- §4 console shell (layout + welcome) → Tasks 5, 6 ✓
- §5 rail (jobs by role, status dots, admin `＋`/`🔒`/Settings, guest contact) → Task 5 ✓
- §6 job detail restyle + schedule-form scheduleType → Task 7 (+ Task 4 mapping) ✓
- §7 submit-a-job `/dashboard/new` → Task 8 ✓
- §8 Settings Notifications + Access (+ send-test) → Tasks 9, 10 ✓
- §9 guest experience → reuses Phase 3 (Tasks 5–7 hide controls) ✓
- §10 testing (pure `lib/ui/*` unit-tested; visual via build + manual) → Tasks 2, 4, 11 ✓
- Out of scope (correctly absent): rename/cleanup (Phase 5), new job types.

**Placeholder scan:** New components/modules have full code; restyle-in-place steps (Task 2 Step 6, Task 3 Step 2, Task 7 Step 3) give exact token classes + "read first, keep props/logic" rules rather than re-pasting large aesthetic files — appropriate for a visual phase driven by the frontend-design skill. No TBD/TODO.

**Type consistency:** `ScheduleFieldsState`/`DEFAULT_SCHEDULE_FIELDS`/`scheduleFieldsToPayload`/`scheduleFieldsToSettings`/`scheduleFieldsFromJob` (Task 4) are consumed identically by `schedule-form` (Task 7) and `new-job-form` (Task 8). `statusColorVar`/`StatusDot` (Task 2) consumed by the rail (Task 5) and history (Task 7). Rail `RailJob` shape matches the layout's `railJobs` projection (Task 5). `POST /api/jobs` body matches Phase 2's `createJobSchema` (type/name/visibleToGuest/schedule discriminated union). `PATCH /api/settings/access` body matches Phase 3 (`guestMode`/`adminContactPhone`).
