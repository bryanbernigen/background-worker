import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '@/lib/auth';

describe('auth helpers', () => {
  it('creates and verifies a session token', () => {
    const token = createSessionToken('admin');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const payload = verifySessionToken(token);
    expect(payload?.username).toBe('admin');
  });

  it('throws on invalid token', () => {
    const payload = verifySessionToken('invalid.token.here');
    expect(payload).toBeNull();
  });
});
