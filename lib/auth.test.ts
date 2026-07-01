import { describe, it, expect, beforeAll } from 'vitest';
import { createSessionToken, verifySessionToken } from './auth';

beforeAll(() => { process.env.JWT_SECRET = 'test-secret'; });

describe('session roles', () => {
  it('round-trips an admin token', async () => {
    const t = await createSessionToken('admin');
    const s = await verifySessionToken(t);
    expect(s?.username).toBe('admin');
    expect(s?.role).toBe('admin');
  });
  it('round-trips a guest token', async () => {
    const t = await createSessionToken('viewer', 'guest');
    expect((await verifySessionToken(t))?.role).toBe('guest');
  });
  it('rejects a tampered token', async () => {
    const t = await createSessionToken('admin');
    expect(await verifySessionToken(t + 'x')).toBeNull();
  });
});
