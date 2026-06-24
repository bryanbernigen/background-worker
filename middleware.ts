// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Pass-through for public paths
  if (pathname === '/' || pathname === '/api/auth/login' || pathname === '/api/auth/logout') {
    return NextResponse.next();
  }

  // 1b. Health endpoint — for external uptime monitors. Gated by HEALTH_CHECK_TOKEN
  // via `Authorization: Bearer <token>` or a `?token=` query param (the query param
  // works on monitors that can't set headers, e.g. UptimeRobot free). A valid
  // dashboard session also works. If the token isn't configured, leave it open.
  if (pathname === '/api/health') {
    const expected = process.env.HEALTH_CHECK_TOKEN;
    if (!expected) return NextResponse.next();
    const auth = req.headers.get('authorization');
    const bearer = auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : null;
    const provided = bearer ?? req.nextUrl.searchParams.get('token');
    if (provided === expected) return NextResponse.next();
    const token = req.cookies.get('session')?.value;
    if (token && await verifySessionToken(token)) return NextResponse.next();
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 2. Cron Endpoints Gate Guard
  if (pathname === '/api/cron/check' || pathname === '/api/cron/tick') {
    const cronSecret = req.headers.get('x-cron-secret');
    const isScheduled = cronSecret !== null && cronSecret === process.env.CRON_SECRET;

    if (isScheduled) {
      // Forward the request and flag it explicitly as a scheduled trigger
      const responseHeaders = new Headers(req.headers);
      responseHeaders.set('x-trigger-type', 'scheduled');
      return NextResponse.next({
        request: { headers: responseHeaders },
      });
    }

    // If it's not a scheduled cron, check if it's a valid dashboard session
    const token = req.cookies.get('session')?.value;
    const session = token ? await verifySessionToken(token) : null;

    if (session) {
      // Forward the request and flag it explicitly as a manual trigger
      const responseHeaders = new Headers(req.headers);
      responseHeaders.set('x-trigger-type', 'manual');
      return NextResponse.next({
        request: { headers: responseHeaders },
      });
    }

    // Fail immediately if it is neither
    return new NextResponse('Unauthorized: Invalid Cron Secret or Missing Dashboard Session', { status: 401 });
  }

  // 3. Secure all other paths (Dashboards, etc.)
  const token = req.cookies.get('session')?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    // API requests get a clean 401 — redirecting a PATCH/POST to "/" (a GET-only
    // page) would surface as a confusing 405. Page navigations still redirect.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};