import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { createSessionToken } from './lib/auth';

function req(method: string, path: string, token?: string) {
  const r = new NextRequest(`https://app.example.com${path}`, { method });
  if (token) r.cookies.set('session', token);
  return r;
}

describe('middleware auth gate', () => {
  it('returns 401 (not a redirect) for unauthenticated API requests', async () => {
    const res = await middleware(req('PATCH', '/api/jobs/data-annotation/settings'));
    // Must NOT be a 3xx redirect to "/", which would turn a PATCH into a 405.
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated page navigations to /', async () => {
    const res = await middleware(req('GET', '/dashboard'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/');
  });

  it('lets authenticated API requests through', async () => {
    const token = await createSessionToken('admin');
    const res = await middleware(req('PATCH', '/api/jobs/data-annotation/settings', token));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
