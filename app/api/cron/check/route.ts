// app/api/cron/check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkers } from '@/lib/checkers';
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

export async function GET(req: NextRequest) {
  // Manual trigger from dashboard uses x-cron-secret: 'manual'
  const isManual = req.headers.get('x-cron-secret') === 'manual';
  const settings = await getAppSettings();

  // Time window check (skip for manual triggers)
  if (!isManual && !isWithinTimeWindow(settings)) {
    return NextResponse.json({ message: 'Outside time window' });
  }

  // Check next_allowed_run (skip for manual triggers)
  const nextAllowed = await kvGet<string>('next_allowed_run');
  if (!isManual && nextAllowed) {
    if (new Date() < new Date(nextAllowed)) {
      return NextResponse.json({ message: `Too early. Next run: ${nextAllowed}` });
    }
  }

  // Acquire lock to prevent overlapping runs
  const lockKey = 'cron_lock';
  const lockVal = `locked_${Date.now()}`;
  if (!isManual) {
    const existing = await kvGet<string>(lockKey);
    if (existing) {
      return NextResponse.json({ message: 'Another run in progress' });
    }
    await kvSet(lockKey, lockVal, 300); // 5-min TTL
  }

  try {
    // Generate new random interval for next run (10-30 minutes)
    const nextMinutes = randomBetween(10, 30);
    const nextRun = new Date(Date.now() + nextMinutes * 60 * 1000);
    await kvSet('next_allowed_run', nextRun.toISOString());
    await kvSet('last_checked', new Date().toISOString());

    // Run all enabled checkers
    const results = [];
    for (const checker of checkers) {
      try {
        const result = await checker.run();
        results.push(result);
      } catch (err) {
        results.push({
          checkerName: checker.name,
          newItems: [],
          errors: [String(err)],
        });
      }
    }

    return NextResponse.json({
      message: 'Check completed',
      nextRun: nextRun.toISOString(),
      results,
    });
  } finally {
    // Release lock
    if (!isManual) {
      await kvSet(lockKey, '', 1);
    }
  }
}
