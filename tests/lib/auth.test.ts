import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '@/lib/auth';

describe('auth helpers', () => {
  it('creates and verifies a session token', async () => {
    const token = await createSessionToken('admin');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const payload = await verifySessionToken(token);
    expect(payload?.username).toBe('admin');
  });

  it('returns null on invalid token', async () => {
    const payload = await verifySessionToken('invalid.token.here');
    expect(payload).toBeNull();
  });
});
