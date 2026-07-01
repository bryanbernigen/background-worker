import { describe, it, expect } from 'vitest';
import { guestModeFromValue } from './settings';

describe('guestModeFromValue', () => {
  it('defaults to true when unset', () => {
    expect(guestModeFromValue(undefined)).toBe(true);
    expect(guestModeFromValue(null)).toBe(true);
  });
  it('honors an explicit boolean', () => {
    expect(guestModeFromValue(false)).toBe(false);
    expect(guestModeFromValue(true)).toBe(true);
  });
});
