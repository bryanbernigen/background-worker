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
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};