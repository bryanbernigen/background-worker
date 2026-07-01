import { describe, it, expect } from 'vitest';
import {
  isWithinWindow, nextWindowOpening, jitter, computeNextRunAt,
  cronNextRun, validateSchedule, type ScheduleCfg,
} from './window';

const W: ScheduleCfg = {
  scheduleType: 'window',
  minIntervalS: 600, maxIntervalS: 1800,
  dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7, // WIB
  intervalS: null, cronExpr: null,
};

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
  it('jitters past the next window opening when jitter overshoots the window end', () => {
    const now = wib(2026, 6, 1, 22, 50);
    // min=max=1800s (30min) => raw next = 23:20 (outside). Clamp to next day 07:00,
    // then offset by the jitter so it does not fire exactly at the opening hour.
    const out = computeNextRunAt(now, { ...W, minIntervalS: 1800, maxIntervalS: 1800 });
    expect(out.toISOString()).toBe(wib(2026, 6, 2, 7, 30).toISOString());
  });
  it('jitters past the next window opening when called outside the window', () => {
    const now = wib(2026, 6, 1, 3, 0);
    // min=max=600s (10min) => opening 07:00 + 10min = 07:10, not 07:00 sharp.
    const out = computeNextRunAt(now, { ...W, minIntervalS: 600, maxIntervalS: 600 });
    expect(out.toISOString()).toBe(wib(2026, 6, 1, 7, 10).toISOString());
  });
  it('keeps the jittered window-opening start inside [open+min, open+max]', () => {
    const now = wib(2026, 6, 1, 3, 0);
    for (let i = 0; i < 1000; i++) {
      const out = computeNextRunAt(now, { ...W, minIntervalS: 600, maxIntervalS: 1800 });
      const offsetS = (out.getTime() - wib(2026, 6, 1, 7, 0).getTime()) / 1000;
      expect(offsetS).toBeGreaterThanOrEqual(600);
      expect(offsetS).toBeLessThanOrEqual(1800);
    }
  });
});

describe('interval schedule', () => {
  it('computeNextRunAt = now + intervalS', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const next = computeNextRunAt(now, { ...W, scheduleType: 'interval', intervalS: 300 });
    expect(next.getTime()).toBe(now.getTime() + 300_000);
  });
  it('isWithinWindow is always true for interval', () => {
    expect(isWithinWindow(new Date('2026-07-01T20:00:00Z'), { ...W, scheduleType: 'interval', intervalS: 300 })).toBe(true);
  });
});

describe('cron schedule (offset model)', () => {
  it('fires daily at 09:00 in the job offset (tz+7 -> 02:00 UTC)', () => {
    // now = 2026-07-01 00:00 UTC == 07:00 local(+7); next 09:00 local == 02:00 UTC same day
    const next = cronNextRun(new Date('2026-07-01T00:00:00Z'), '0 9 * * *', 7);
    expect(next.toISOString()).toBe('2026-07-01T02:00:00.000Z');
  });
  it('computeNextRunAt routes cron through cronNextRun', () => {
    const next = computeNextRunAt(new Date('2026-07-01T00:00:00Z'), { ...W, scheduleType: 'cron', cronExpr: '0 9 * * *' });
    expect(next.toISOString()).toBe('2026-07-01T02:00:00.000Z');
  });
  it('isWithinWindow is always true for cron', () => {
    expect(isWithinWindow(new Date('2026-07-01T03:00:00Z'), { ...W, scheduleType: 'cron', cronExpr: '0 9 * * *' })).toBe(true);
  });
});

describe('validateSchedule', () => {
  it('accepts a valid window/interval/cron', () => {
    expect(() => validateSchedule(W)).not.toThrow();
    expect(() => validateSchedule({ ...W, scheduleType: 'interval', intervalS: 300 })).not.toThrow();
    expect(() => validateSchedule({ ...W, scheduleType: 'cron', cronExpr: '*/15 * * * *' })).not.toThrow();
  });
  it('rejects interval without a positive intervalS', () => {
    expect(() => validateSchedule({ ...W, scheduleType: 'interval', intervalS: null })).toThrow();
    expect(() => validateSchedule({ ...W, scheduleType: 'interval', intervalS: 0 })).toThrow();
  });
  it('rejects cron with no/invalid expression', () => {
    expect(() => validateSchedule({ ...W, scheduleType: 'cron', cronExpr: null })).toThrow();
    expect(() => validateSchedule({ ...W, scheduleType: 'cron', cronExpr: 'not a cron' })).toThrow();
  });
  it('rejects window with min > max', () => {
    expect(() => validateSchedule({ ...W, minIntervalS: 2000, maxIntervalS: 1000 })).toThrow();
  });
});
