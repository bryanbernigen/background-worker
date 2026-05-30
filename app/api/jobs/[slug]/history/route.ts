import { NextRequest, NextResponse } from 'next/server';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const url = new URL(req.url);
  const page     = Math.max(1,  parseInt(url.searchParams.get('page')     ?? '1',  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '25', 10)));
  const detailId = url.searchParams.get('detailId');

  if (detailId) {
    const id = Number(detailId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad detailId' }, { status: 400 });
    const [row] = await db.select().from(runHistory)
      .where(eq(runHistory.id, id)).limit(1);
    if (!row || row.jobId !== job.id) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ detail: row });
  }

  const rows = await db.select({
    id: runHistory.id,
    startedAt: runHistory.startedAt, finishedAt: runHistory.finishedAt,
    status: runHistory.status, triggerType: runHistory.triggerType,
    skipReason: runHistory.skipReason, diffMs: runHistory.diffMs,
    paidProjects: runHistory.paidProjects, allProjects: runHistory.allProjects,
    paidQualifications: runHistory.paidQualifications, allQualifications: runHistory.allQualifications,
    newPaidProjects: runHistory.newPaidProjects, newAllProjects: runHistory.newAllProjects,
    newPaidQualifications: runHistory.newPaidQualifications, newAllQualifications: runHistory.newAllQualifications,
    notificationSent: runHistory.notificationSent,
  })
    .from(runHistory).where(eq(runHistory.jobId, job.id))
    .orderBy(desc(runHistory.startedAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  const countResult = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM run_history WHERE job_id = ${job.id}`
  );
  const total = (countResult as unknown as { rows?: { count: number }[] }).rows?.[0]?.count
    ?? (countResult as unknown as { count: number }[])[0]?.count
    ?? 0;

  return NextResponse.json({ rows, page, pageSize, total });
}
