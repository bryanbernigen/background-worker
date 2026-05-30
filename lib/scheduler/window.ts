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

export function computeNextRunAt(now: Date, cfg: Window & JitterCfg): Date {
  if (!isWithinWindow(now, cfg)) return nextWindowOpening(now, cfg);
  const raw = new Date(now.getTime() + jitter(cfg.minIntervalS, cfg.maxIntervalS) * 1000);
  if (!isWithinWindow(raw, cfg)) return nextWindowOpening(raw, cfg);
  return raw;
}
