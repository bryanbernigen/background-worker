import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { runManual } from '@/lib/scheduler';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  const { slug } = await params;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const out = await runManual(job.id);
  if (out.status === 'lock_busy') {
    return NextResponse.json({ error: 'A run is already in progress' }, { status: 409 });
  }
  return NextResponse.json({ status: 'ran', result: out.result });
}
