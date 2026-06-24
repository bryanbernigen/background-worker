import { describe, it, expect } from 'vitest';
import { customSettingsSchema } from './index';

describe('customSettingsSchema', () => {
  it('accepts the reset shape written on a fresh cookie save (nulls)', () => {
    // The settings route clears these to null before the validation run
    // repopulates them — null must validate, or the PATCH 400s.
    const r = customSettingsSchema.safeParse({
      cookie_encrypted: 'abc',
      cookie_warned: false,
      cookie_invalid: false,
      cookie_expires_at: null,
      cookie_checked_at: null,
    });
    expect(r.success).toBe(true);
  });

  it('accepts populated numeric expiry/checked timestamps', () => {
    const r = customSettingsSchema.safeParse({
      cookie_encrypted: 'abc', cookie_expires_at: 1782366605000, cookie_checked_at: 1782000000000,
    });
    expect(r.success).toBe(true);
  });

  it('still rejects a non-numeric expiry', () => {
    expect(customSettingsSchema.safeParse({ cookie_expires_at: 'soon' }).success).toBe(false);
  });
});
