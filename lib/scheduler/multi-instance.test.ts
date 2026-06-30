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
