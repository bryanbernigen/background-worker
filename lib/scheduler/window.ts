import { Cron } from 'croner';

export interface Window {
  dayStartHour: number;   // 0–23
  dayEndHour:   number;   // 0–23, right-exclusive
  tzOffsetH:    number;   // hours offset from UTC
}

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

export interface JitterCfg {
  minIntervalS: number;
  maxIntervalS: number;
}

function localHour(d: Date, tzOffsetH: number): number {
  return new Date(d.getTime() + tzOffsetH * 3600 * 1000).getUTCHours();
}

export function isWithinWindow(now: Date, cfg: ScheduleCfg | Window): boolean {
  if ('scheduleType' in cfg && cfg.scheduleType !== 'window') return true;
  const h = localHour(now, cfg.tzOffsetH);
  return h >= cfg.dayStartHour && h < cfg.dayEndHour;
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

/** The next `dayStartHour:00` local-time instant strictly after `now`. */
export function nextWindowOpening(now: Date, w: Window): Date {
  const local = new Date(now.getTime() + w.tzOffsetH * 3600 * 1000);
  const todayStartLocal = new Date(Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(),
    w.dayStartHour, 0, 0,
  ));
  const todayStartUtc = new Date(todayStartLocal.getTime() - w.tzOffsetH * 3600 * 1000);
  if (todayStartUtc.getTime() > now.getTime()) return todayStartUtc;
  return new Date(todayStartUtc.getTime() + 24 * 3600 * 1000);
}

export function jitter(minS: number, maxS: number): number {
  if (minS > maxS) throw new Error('minIntervalS > maxIntervalS');
  return Math.floor(Math.random() * (maxS - minS + 1)) + minS;
}

/** Window opening offset by a fresh jitter, so the first run of the day
 *  doesn't fire at exactly `dayStartHour:00` — same variability as daytime runs. */
function jitteredWindowOpening(now: Date, cfg: Window & JitterCfg): Date {
  const opening = nextWindowOpening(now, cfg);
  return new Date(opening.getTime() + jitter(cfg.minIntervalS, cfg.maxIntervalS) * 1000);
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
