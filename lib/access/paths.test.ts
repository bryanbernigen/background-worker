import { describe, it, expect } from 'vitest';
import { requiresAdminToken } from './paths';

describe('requiresAdminToken', () => {
  it('guards mutating /api routes', () => {
    expect(requiresAdminToken('/api/jobs', 'POST')).toBe(true);
    expect(requiresAdminToken('/api/jobs/x/settings', 'PATCH')).toBe(true);
    expect(requiresAdminToken('/api/jobs/x', 'DELETE')).toBe(true);
  });
  it('allows GET /api routes (handlers gate reads)', () => {
    expect(requiresAdminToken('/api/jobs/x/history', 'GET')).toBe(false);
  });
  it('exempts public + specially-gated routes', () => {
    expect(requiresAdminToken('/api/auth/login', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/auth/logout', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/contact', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/cron/check', 'POST')).toBe(false);
    expect(requiresAdminToken('/api/health', 'POST')).toBe(false);
  });
  it('does not guard page routes', () => {
    expect(requiresAdminToken('/dashboard', 'GET')).toBe(false);
    expect(requiresAdminToken('/dashboard/jobs/x', 'POST')).toBe(false);
  });
});
