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
  var __expiryTimers: Map<number, NodeJS.Timeout> | undefined;
  // eslint-disable-next-line no-var
  var __schedulerStarted: boolean | undefined;
}

const timers: Map<number, NodeJS.Timeout> =
  globalThis.__schedulerTimers ?? (globalThis.__schedulerTimers = new Map());

// Separate timers that fire the "cookie expires in ~24h" warning, armed
// independently of the scrape timers (and of job.enabled).
const expiryTimers: Map<number, NodeJS.Timeout> =
  globalThis.__expiryTimers ?? (globalThis.__expiryTimers = new Map());

/** How far ahead of expiry to send the warning. */
const EXPIRY_WARN_LEAD_MS = 24 * 60 * 60 * 1000;
/** setTimeout caps at ~24.8 days; clamp longer waits and re-arm later. */
const MAX_TIMEOUT_MS = 2_147_483_647;

function isStarted(): boolean { return globalThis.__schedulerStarted === true; }
function setStarted(v: boolean): void { globalThis.__schedulerStarted = v; }

/** Liveness snapshot for the health endpoint. */
export function schedulerStatus(): { started: boolean; armedTimers: number } {
  return { started: isStarted(), armedTimers: timers.size };
}

type Trigger = 'scheduled' | 'manual';

export interface ManualRunOutcome {
  status: 'ran' | 'lock_busy';
  result?: RunResult;
}

/** Boot the scheduler. Idempotent across module reloads (HMR). */
export async function start(): Promise<void> {
  if (isStarted()) return;
  setStarted(true);
  const enabled = await db.select().from(jobs).where(eq(jobs.enabled, true));
  for (const job of enabled) await armTimer(job.id);
  // Expiry warnings are armed for ALL jobs, regardless of enabled — you still
  // want to be told the cookie is about to die even if scraping is paused.
  const all = await db.select({ id: jobs.id }).from(jobs);
  for (const job of all) await armExpiryTimer(job.id);
  process.on('unhandledRejection', err => {
    console.error('[scheduler] unhandledRejection', err);
  });
  console.log(`[scheduler] started — ${enabled.length} job(s) armed`);
}

/** Stop all timers (for tests / shutdown). */
export function stop(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  for (const t of expiryTimers.values()) clearTimeout(t);
  expiryTimers.clear();
  setStarted(false);
}

/** Re-read job from DB and re-arm its timer. Call after settings change. */
export async function reschedule(jobId: number): Promise<void> {
  const existing = timers.get(jobId);
  if (existing) { clearTimeout(existing); timers.delete(jobId); }
  await armTimer(jobId);
  await armExpiryTimer(jobId);
}

/** Manual run (HTTP-triggered). Returns lock_busy if a scheduled run is in flight. */
export async function runManual(jobId: number): Promise<ManualRunOutcome> {
  const r = await executeRun(jobId, 'manual');
  // A run may have refreshed the cookie expiry — re-arm the warning timer.
  await armExpiryTimer(jobId);
  if (r.kind === 'lock_busy') return { status: 'lock_busy' };
  return { status: 'ran', result: r.kind === 'ran' ? r.result : undefined };
}

// ---------- internals ----------

async function armTimer(jobId: number): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return;

  // Clear any pre-existing timer first — defensive against double-arming.
  const prev = timers.get(jobId);
  if (prev) clearTimeout(prev);
  timers.delete(jobId);

  // Disabled: ensure no timer AND clear nextRunAt so the UI shows "paused"
  // rather than counting down toward a run that will never fire.
  if (!job.enabled) {
    if (job.nextRunAt) {
      await db.update(jobs).set({ nextRunAt: null, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    }
    return;
  }

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

// ---------- cookie-expiry warning ----------

/**
 * Arm (or clear) the one-shot "cookie expires in ~24h" warning for a job.
 * Reads the expiry the scraper stored in custom_settings. Fires once per cookie
 * (cleared by `cookie_warned`, which the settings route resets on a new cookie).
 */
export async function armExpiryTimer(jobId: number): Promise<void> {
  const prev = expiryTimers.get(jobId);
  if (prev) { clearTimeout(prev); expiryTimers.delete(jobId); }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return;
  const custom = (job.customSettings ?? {}) as Record<string, unknown>;
  const expiresAt = typeof custom.cookie_expires_at === 'number' ? custom.cookie_expires_at : null;
  if (!expiresAt || custom.cookie_warned === true) return;

  const delay = expiresAt - EXPIRY_WARN_LEAD_MS - Date.now();
  if (delay <= 0) {
    // Warn window already reached (e.g. caught up on boot) — fire now.
    await fireExpiryWarning(jobId);
    return;
  }
  const t = setTimeout(() => { void fireExpiryWarning(jobId); }, Math.min(delay, MAX_TIMEOUT_MS));
  expiryTimers.set(jobId, t);
}

async function fireExpiryWarning(jobId: number): Promise<void> {
  expiryTimers.delete(jobId);
  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return;
    const custom = (job.customSettings ?? {}) as Record<string, unknown>;
    if (custom.cookie_warned === true) return;
    const expiresAt = typeof custom.cookie_expires_at === 'number' ? custom.cookie_expires_at : null;
    if (!expiresAt) return;

    // The clamp above can wake us before the real warn time — re-arm and wait.
    const delay = expiresAt - EXPIRY_WARN_LEAD_MS - Date.now();
    if (delay > 0) {
      const t = setTimeout(() => { void fireExpiryWarning(jobId); }, Math.min(delay, MAX_TIMEOUT_MS));
      expiryTimers.set(jobId, t);
      return;
    }

    const recps = await db.select().from(recipients)
      .where(and(eq(recipients.jobId, jobId), eq(recipients.kind, 'cookie')));
    const wahaUrl = process.env.WAHA_URL;
    if (wahaUrl && recps.length) {
      const waha = new WahaClient(wahaUrl, process.env.WAHA_API_KEY ?? '');
      const msg = formatExpiryWarning(job, expiresAt);
      let anySent = false;
      for (const r of recps) {
        try { anySent = (await waha.sendText(r.phone, msg)) || anySent; }
        catch (e) { console.error(`[scheduler] cookie-expiry send failed for ${r.phone}`, e); }
      }
      // If every send failed, leave cookie_warned unset so a later arm retries.
      if (!anySent) return;
    }

    await db.update(jobs)
      .set({ customSettings: { ...custom, cookie_warned: true }, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
  } catch (err) {
    console.error(`[scheduler] fireExpiryWarning failed for job ${jobId}`, err);
  }
}

function formatExpiryWarning(job: Job, expiresAt: number): string {
  return (
    `⚠️ *Cookie Expiring* ⚠️\n\n` +
    `${job.title} session cookie expires in ~24h (${formatInTz(expiresAt, job.tzOffsetH)}).\n\n` +
    `_Log in and paste a fresh cookie from the dashboard to keep monitoring running._`
  );
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** "Jun 25, 2026 12:50 (UTC+7)" — formatted at the job's configured offset. */
function formatInTz(ms: number, tzOffsetH: number): string {
  const d = new Date(ms + tzOffsetH * 3_600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const sign = tzOffsetH >= 0 ? '+' : '-';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm} (UTC${sign}${Math.abs(tzOffsetH)})`;
}

async function onTimerFire(jobId: number): Promise<void> {
  try {
    await executeRun(jobId, 'scheduled');
    // A successful run may have refreshed the cookie expiry — re-arm the warning.
    await armExpiryTimer(jobId);
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

    // Only 'project' recipients get new-task alerts. Cookie-expiry warnings go
    // to 'cookie' recipients via fireExpiryWarning — selecting all kinds here
    // would double-message anyone listed in both panels.
    const recps = await db.select().from(recipients)
      .where(and(eq(recipients.jobId, jobId), eq(recipients.kind, 'project')));
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
