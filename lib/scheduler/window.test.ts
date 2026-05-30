import { describe, it, expect } from 'vitest';
import {
  isWithinWindow, nextWindowOpening, jitter, computeNextRunAt,
} from './window';

const W = { dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7 }; // WIB

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
  it('clamps to next window opening when jitter overshoots the window end', () => {
    const now = wib(2026, 6, 1, 22, 50);
    // min=max=1800s (30min) => raw next = 23:20 (outside). Clamp to next day 07:00.
    const out = computeNextRunAt(now, { ...W, minIntervalS: 1800, maxIntervalS: 1800 });
    expect(out.toISOString()).toBe(wib(2026, 6, 2, 7, 0).toISOString());
  });
  it('clamps to next window opening when called outside the window', () => {
    const now = wib(2026, 6, 1, 3, 0);
    const out = computeNextRunAt(now, { ...W, minIntervalS: 600, maxIntervalS: 1800 });
    expect(out.toISOString()).toBe(wib(2026, 6, 1, 7, 0).toISOString());
  });
});
