import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { isWithinWindow } from '@/lib/scheduler/window';
import { schedulerStatus } from '@/lib/scheduler';
import { WahaClient } from '@/lib/waha';
import { computeHealth, healthHttpStatus, type JobHealthInput } from '@/lib/health';

// Always evaluated fresh — never cached.
export const dynamic = 'force-dynamic';

// Access is gated in middleware via HEALTH_CHECK_TOKEN; the body avoids secrets.
export async function GET() {
  const now = Date.now();

  // 1. Database
  let dbOk = true;
  try { await db.execute(sql`select 1`); } catch { dbOk = false; }

  // 2. WAHA — only `WORKING` means it can actually send.
  const wahaUrl = process.env.WAHA_URL;
  const waha = { configured: !!wahaUrl, reachable: false, status: null as string | null, account: null as string | null };
  if (wahaUrl) {
    try {
      const s = await new WahaClient(wahaUrl, process.env.WAHA_API_KEY ?? '')
        .getSessionStatus(process.env.WAHA_SESSION ?? 'default');
      waha.reachable = true;
      waha.status = s.status;
      waha.account = s.me?.pushName ?? s.me?.id ?? null;
    } catch { /* unreachable — leave reachable=false */ }
  }

  // 3. Per-job: window state, last successful run age, cookie state.
  const allJobs = dbOk ? await db.select().from(jobs) : [];
  const jobInputs: JobHealthInput[] = [];
  for (const j of allJobs) {
    const [lastOk] = await db.select({ finishedAt: runHistory.finishedAt })
      .from(runHistory)
      .where(and(eq(runHistory.jobId, j.id), eq(runHistory.status, 'ok')))
      .orderBy(desc(runHistory.startedAt)).limit(1);
    const custom = (j.customSettings ?? {}) as Record<string, unknown>;
    jobInputs.push({
      slug: j.slug,
      enabled: j.enabled,
      withinWindow: isWithinWindow(new Date(now), { dayStartHour: j.dayStartHour, dayEndHour: j.dayEndHour, tzOffsetH: j.tzOffsetH }),
      lastSuccessAt: lastOk?.finishedAt ? lastOk.finishedAt.getTime() : null,
      maxIntervalS: j.maxIntervalS,
      cookieExpiresAt: typeof custom.cookie_expires_at === 'number' ? custom.cookie_expires_at : null,
      cookieInvalid: custom.cookie_invalid === true,
    });
  }

  const report = computeHealth({
    now,
    database: { ok: dbOk },
    scheduler: schedulerStatus(),
    waha,
    jobs: jobInputs,
  });

  return NextResponse.json(
    { ...report, time: new Date(now).toISOString() },
    { status: healthHttpStatus(report.status) },
  );
}
