import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unschedule } from './index';

describe('unschedule', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears a job run timer so its callback never fires', () => {
    const fired = vi.fn();
    const timers = (globalThis as Record<string, unknown>).__schedulerTimers as Map<number, NodeJS.Timeout>;
    timers.set(42, setTimeout(fired, 1000) as unknown as NodeJS.Timeout);
    unschedule(42);
    vi.advanceTimersByTime(5000);
    expect(fired).not.toHaveBeenCalled();
    expect(timers.has(42)).toBe(false);
  });
});
