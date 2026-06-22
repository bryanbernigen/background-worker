import { describe, it, expect } from 'vitest';
import { computeHealth, healthHttpStatus, type HealthInput } from './health';

const NOW = 1_800_000_000_000;

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  now: NOW,
  database: { ok: true },
  scheduler: { started: true, armedTimers: 1 },
  waha: { configured: true, reachable: true, status: 'WORKING', account: 'Me' },
  jobs: [{
    slug: 'data-annotation', enabled: true, withinWindow: true,
    lastSuccessAt: NOW - 60_000, maxIntervalS: 1800,
    cookieExpiresAt: NOW + 86_400_000, cookieInvalid: false,
  }],
  ...over,
});

describe('computeHealth', () => {
  it('is ok when everything is healthy', () => {
    const r = computeHealth(base());
    expect(r.status).toBe('ok');
    expect(healthHttpStatus(r.status)).toBe(200);
  });

  it('is down when the database is unreachable', () => {
    expect(computeHealth(base({ database: { ok: false } })).status).toBe('down');
  });

  it('is down when the scheduler has not started', () => {
    expect(computeHealth(base({ scheduler: { started: false, armedTimers: 0 } })).status).toBe('down');
  });

  it('is degraded when WAHA session is not WORKING (expired/SCAN_QR_CODE)', () => {
    const r = computeHealth(base({ waha: { configured: true, reachable: true, status: 'SCAN_QR_CODE', account: null } }));
    expect(r.status).toBe('degraded');
    expect(r.checks.waha.ok).toBe(false);
    expect(healthHttpStatus(r.status)).toBe(503);
  });

  it('is degraded when WAHA is unreachable', () => {
    expect(computeHealth(base({ waha: { configured: true, reachable: false, status: null, account: null } })).status).toBe('degraded');
  });

  it('is degraded when the cookie has expired', () => {
    const r = computeHealth(base({ jobs: [{
      slug: 'data-annotation', enabled: true, withinWindow: true,
      lastSuccessAt: NOW - 60_000, maxIntervalS: 1800,
      cookieExpiresAt: NOW - 1, cookieInvalid: false,
    }] }));
    expect(r.status).toBe('degraded');
    expect(r.checks.jobs[0].cookieValid).toBe(false);
  });

  it('is degraded when the cookie was rejected', () => {
    expect(computeHealth(base({ jobs: [{
      slug: 'data-annotation', enabled: true, withinWindow: true,
      lastSuccessAt: NOW - 60_000, maxIntervalS: 1800,
      cookieExpiresAt: null, cookieInvalid: true,
    }] })).status).toBe('degraded');
  });

  it('flags a stale job inside the window', () => {
    const r = computeHealth(base({ jobs: [{
      slug: 'data-annotation', enabled: true, withinWindow: true,
      lastSuccessAt: NOW - 3 * 1800_000 - 1000, maxIntervalS: 1800,
      cookieExpiresAt: NOW + 86_400_000, cookieInvalid: false,
    }] }));
    expect(r.checks.jobs[0].stale).toBe(true);
    expect(r.status).toBe('degraded');
  });

  it('does not flag staleness outside the window', () => {
    const r = computeHealth(base({ jobs: [{
      slug: 'data-annotation', enabled: true, withinWindow: false,
      lastSuccessAt: NOW - 100 * 3600_000, maxIntervalS: 1800,
      cookieExpiresAt: NOW + 86_400_000, cookieInvalid: false,
    }] }));
    expect(r.checks.jobs[0].stale).toBe(false);
    expect(r.status).toBe('ok');
  });

  it('does not fail health for a job with no cookie info', () => {
    const r = computeHealth(base({ jobs: [{
      slug: 'data-annotation', enabled: true, withinWindow: true,
      lastSuccessAt: NOW - 60_000, maxIntervalS: 1800,
      cookieExpiresAt: null, cookieInvalid: false,
    }] }));
    expect(r.status).toBe('ok');
  });
});
