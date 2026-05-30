// app/api/cron/tick/route.ts
// Called by cron-job.org every 1 minute
// Returns immediately, runs sleep + check in background
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

interface AppSettings {
  timezoneOffset: number;
  dayStartHour: number;
  dayEndHour: number;
}

async function getAppSettings(): Promise<AppSettings> {
  const settings = await kvGet<AppSettings>('app_settings');
  return settings ?? { timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 };
}

function isWithinTimeWindow(settings: AppSettings): boolean {
  const now = new Date();
  const local = new Date(now.getTime() + settings.timezoneOffset * 60 * 60 * 1000);
  const hour = local.getUTCHours();
  return hour >= settings.dayStartHour && hour <= settings.dayEndHour;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function runBackgroundCheck(req: NextRequest) {
  // Guard: outside time window -> skip
  const settings = await getAppSettings();
  if (!isWithinTimeWindow(settings)) {
      const nextMinutes = randomBetween(10, 30);
      const nextRun = new Date(Date.now() + nextMinutes * 60 * 1000);
      await kvSet('next_allowed_run', nextRun.toISOString());
  }

  // Guard: not yet time -> skip
  const nextAllowed = await kvGet<string>('next_allowed_run');
  if (nextAllowed && new Date() < new Date(nextAllowed)) return;

  // Random delay before the check (0 to 59 seconds)
  const delayMs = Math.floor(Math.random() * 59000); 
  await new Promise(resolve => setTimeout(resolve, delayMs));

  // Determine the base domain using Railway's environment variable
  const baseDomain = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : req.url; 

  // Forward to check endpoint
  const checkUrl = new URL('/api/cron/check', baseDomain);
  
  // Extract the secret from the incoming request (fallback to empty string if missing)
  const incomingSecret = req.headers.get('x-cron-secret') ?? '';

  await fetch(checkUrl, {
    method: 'GET',
    headers: { 'x-cron-secret': incomingSecret },
  });
}

export async function GET(req: NextRequest) {
  // Verify CRON_SECRET
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Guard: outside time window
  const settings = await getAppSettings();
  if (!isWithinTimeWindow(settings)) {
    return NextResponse.json({ message: 'Outside time window' });
  }

  // Guard: not yet time -> skip immediately
  const nextAllowed = await kvGet<string>('next_allowed_run');
  if (nextAllowed && new Date() < new Date(nextAllowed)) {
    return NextResponse.json({ message: `Not yet time. Next run: ${nextAllowed}` });
  }

  // Fire and forget: return immediately, process sleep + check in background
  runBackgroundCheck(req);

  return NextResponse.json({ message: 'Accepted' });
}

