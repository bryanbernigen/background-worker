import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { createSessionToken } from './lib/auth';

function req(method: string, path: string, token?: string) {
  const r = new NextRequest(`https://app.example.com${path}`, { method });
  if (token) r.cookies.set('session', token);
  return r;
}

describe('middleware access gate', () => {
  it('403s an unauthenticated mutating API request (no redirect)', async () => {
    const res = await middleware(req('PATCH', '/api/jobs/data-annotation/settings'));
    expect(res.status).toBe(403);
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets unauthenticated page navigations through (RSC resolves role/redirect)', async () => {
    const res = await middleware(req('GET', '/dashboard'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets unauthenticated GET API requests through (handler enforces viewer + masking)', async () => {
    const res = await middleware(req('GET', '/api/jobs/data-annotation/recipients'));
    expect(res.status).toBe(200);
  });

  it('lets the public contact endpoint through unauthenticated', async () => {
    const res = await middleware(req('POST', '/api/contact'));
    expect(res.status).toBe(200);
  });

  it('lets authenticated admin mutating API requests through', async () => {
    const token = await createSessionToken('admin');
    const res = await middleware(req('PATCH', '/api/jobs/data-annotation/settings', token));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
