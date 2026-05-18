// app/api/cron/check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkers } from '@/lib/checkers';
import { kvGet, kvSet } from '@/lib/kv';

// UTC+7 time check (7AM to 11PM)
function isWithinTimeWindow(): boolean {
  const now = new Date();
  const utc7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  const hour = utc7.getUTCHours();
  return hour >= 7 && hour < 23;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function GET(req: NextRequest) {
  // Manual trigger from dashboard uses x-cron-secret: 'manual'
  const isManual = req.headers.get('x-cron-secret') === 'manual';

  // Time window check (skip for manual triggers)
  if (!isManual && !isWithinTimeWindow()) {
    return NextResponse.json({ message: 'Outside time window (7AM–11PM UTC+7)' });
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
    // Generate new random interval for next run
    const nextMinutes = randomBetween(5, 30);
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
