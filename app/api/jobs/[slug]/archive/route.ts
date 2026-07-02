import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/access/role';
import { unschedule } from '@/lib/scheduler';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  unschedule(job.id);
  await db.update(jobs).set({ archivedAt: new Date(), nextRunAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
  return NextResponse.json({ ok: true });
}
