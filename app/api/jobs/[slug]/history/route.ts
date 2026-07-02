import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc, count } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, runHistory } from '@/lib/db/schema';
import { requireViewer } from '@/lib/access/role';
import { maskRunDetail } from '@/lib/access/mask';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireViewer(); if (!guard.ok) return guard.res;
  const { role } = guard;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (role === 'guest' && (!job.visibleToGuest || job.archivedAt)) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const url = new URL(req.url);
  const page     = Math.max(1,  parseInt(url.searchParams.get('page')     ?? '1',  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '25', 10)));
  const detailId = url.searchParams.get('detailId');
  const notified = url.searchParams.get('notified'); // 'yes' | 'no' | null (=all)
  const status   = url.searchParams.get('status');   // 'ok' | 'error' | 'skipped' | null (=all)
  const trigger  = url.searchParams.get('trigger');  // 'scheduled' | 'manual' | null (=all)

  if (detailId) {
    const id = Number(detailId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad detailId' }, { status: 400 });
    const [row] = await db.select().from(runHistory)
      .where(eq(runHistory.id, id)).limit(1);
    if (!row || row.jobId !== job.id) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ detail: maskRunDetail(role, row) });
  }

  const where = and(
    eq(runHistory.jobId, job.id),
    notified === 'yes' ? eq(runHistory.notificationSent, true)
      : notified === 'no' ? eq(runHistory.notificationSent, false)
      : undefined,
    status === 'ok' || status === 'error' || status === 'skipped'
      ? eq(runHistory.status, status)
      : undefined,
    trigger === 'scheduled' || trigger === 'manual'
      ? eq(runHistory.triggerType, trigger)
      : undefined,
  );

  const rows = await db.select({
    id: runHistory.id,
    startedAt: runHistory.startedAt, finishedAt: runHistory.finishedAt,
    status: runHistory.status, triggerType: runHistory.triggerType,
    skipReason: runHistory.skipReason, diffMs: runHistory.diffMs,
    summary: runHistory.summary,
    notificationSent: runHistory.notificationSent,
  })
    .from(runHistory).where(where)
    .orderBy(desc(runHistory.startedAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  const [{ total }] = await db.select({ total: count() }).from(runHistory).where(where);

  return NextResponse.json({ rows, page, pageSize, total });
}
