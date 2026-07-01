import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/access/role';
import { WahaClient } from '@/lib/waha';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const { slug, id } = await params;
  const recId = Number(id);
  if (!Number.isInteger(recId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const [row] = await db.select().from(recipients)
    .where(and(eq(recipients.id, recId), eq(recipients.jobId, job.id))).limit(1);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const wahaUrl = process.env.WAHA_URL;
  if (!wahaUrl) return NextResponse.json({ error: 'WAHA_URL not configured' }, { status: 500 });
  const waha = new WahaClient(wahaUrl, process.env.WAHA_API_KEY ?? '');
  try {
    const ok = await waha.sendText(row.phone, `✅ Test message from ${job.title} (auto-checker)`);
    if (!ok) return NextResponse.json({ error: 'WAHA returned non-OK' }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
