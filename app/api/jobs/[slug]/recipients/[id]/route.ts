import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';

const update = z.object({ name: z.string().min(1).optional(), phone: z.string().min(5).optional() });

async function lookup(slug: string, id: number) {
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return null;
  const [row] = await db.select().from(recipients)
    .where(and(eq(recipients.id, id), eq(recipients.jobId, job.id))).limit(1);
  return row ?? null;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug, id } = await params;
  const recId = Number(id);
  if (!Number.isInteger(recId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const existing = await lookup(slug, recId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const parsed = update.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const [row] = await db.update(recipients).set(parsed.data)
    .where(eq(recipients.id, recId)).returning();
  return NextResponse.json({ recipient: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug, id } = await params;
  const recId = Number(id);
  if (!Number.isInteger(recId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const existing = await lookup(slug, recId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await db.delete(recipients).where(eq(recipients.id, recId));
  return NextResponse.json({ ok: true });
}
