import { eq, desc, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, recipients, runHistory, type Job } from '@/lib/db/schema';
import { getJob } from '@/lib/jobs/registry';
import type { PaidItem, RunResult } from '@/lib/jobs/types';
import { computeNextRunAt, isWithinWindow } from './window';
import { withJobLock } from './lock';
import { WahaClient } from '@/lib/waha';

// HMR-safe: stash scheduler state on globalThis so dev-mode module reloads
// don't double-arm timers. Without this, Next.js HMR re-evaluates this module,
// resets the local `timers` map, and re-arms timeouts — but the old timeouts
// remain scheduled in Node's event loop, causing concurrent runs that race
// on the advisory lock and produce a spurious skipped-lock_busy row.
declare global {
  // eslint-disable-next-line no-var
  var __schedulerTimers: Map<number, NodeJS.Timeout> | undefined;
  // eslint-disable-next-line no-var
  var __schedulerStarted: boolean | undefined;
}

const timers: Map<number, NodeJS.Timeout> =
  globalThis.__schedulerTimers ?? (globalThis.__schedulerTimers = new Map());

function isStarted(): boolean { return globalThis.__schedulerStarted === true; }
function setStarted(v: boolean): void { globalThis.__schedulerStarted = v; }

type Trigger = 'scheduled' | 'manual';

export interface ManualRunOutcome {
  status: 'ran' | 'lock_busy';
  result?: RunResult;
}

/** Boot the scheduler. Idempotent across module reloads (HMR). */
export async function start(): Promise<void> {
  if (isStarted()) return;
  setStarted(true);
  const all = await db.select().from(jobs).where(eq(jobs.enabled, true));
  for (const job of all) await armTimer(job.id);
  process.on('unhandledRejection', err => {
    console.error('[scheduler] unhandledRejection', err);
  });
  console.log(`[scheduler] started — ${all.length} job(s) armed`);
}

/** Stop all timers (for tests / shutdown). */
export function stop(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  setStarted(false);
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
  return { status: 'ran', result: r.kind === 'ran' ? r.result : undefined };
}

// ---------- internals ----------

async function armTimer(jobId: number): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || !job.enabled) return;

  // Clear any pre-existing timer first — defensive against double-arming.
  const prev = timers.get(jobId);
  if (prev) clearTimeout(prev);

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
  const outcome = await withJobLock<Exclude<ExecOutcome, { kind: 'lock_busy' }>>(jobId, async () => {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Outside-window: scheduled runs skip; manual runs bypass.
    if (trigger === 'scheduled' && !isWithinWindow(new Date(), jobCfg(job))) {
      const startedAt = new Date();
      await db.insert(runHistory).values({
        jobId, startedAt, finishedAt: startedAt,
        status: 'skipped', triggerType: trigger, skipReason: 'outside_window',
        diffMs: await diffSincePrevRun(jobId, startedAt),
      });
      return { kind: 'skipped', reason: 'outside_window' as const };
    }

    const mod = getJob(job.slug);
    if (!mod) {
      const startedAt = new Date();
      await db.insert(runHistory).values({
        jobId, startedAt, finishedAt: startedAt,
        status: 'error', triggerType: trigger,
        errorMessage: `No JobModule registered for slug '${job.slug}'`,
        diffMs: await diffSincePrevRun(jobId, startedAt),
      });
      return { kind: 'ran', result: errorResult(`No JobModule for ${job.slug}`) };
    }

    const recps = await db.select().from(recipients).where(eq(recipients.jobId, jobId));
    const lastSuccess = await loadLastSuccessfulItems(jobId);
    const startedAt = new Date();
    let result: RunResult;
    try {
      result = await mod.runCheck({
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
