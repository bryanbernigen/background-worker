import { describe, it, expect } from 'vitest';
import { roleFromToken } from './role';

const admin = { username: 'a', role: 'admin' as const, exp: Date.now() + 1e6 };

describe('roleFromToken', () => {
  it('valid admin token -> admin', () => {
    expect(roleFromToken(admin, false)).toBe('admin');
    expect(roleFromToken(admin, true)).toBe('admin');
  });
  it('no token + guest mode on -> guest', () => {
    expect(roleFromToken(null, true)).toBe('guest');
  });
  it('no token + guest mode off -> null', () => {
    expect(roleFromToken(null, false)).toBeNull();
  });
});
