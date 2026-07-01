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
