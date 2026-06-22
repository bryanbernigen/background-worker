import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';

const kindSchema = z.enum(['project', 'cookie']);

const create = z.object({
  name:  z.string().min(1),
  phone: z.string().min(5),
  kind:  kindSchema.optional(),
});

async function getJobOr404(slug: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  return job ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const job = await getJobOr404(slug);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  // Optional ?kind=project|cookie filter; omitted → all recipients.
  const kindParam = new URL(req.url).searchParams.get('kind');
  const kind = kindSchema.safeParse(kindParam);
  const where = kind.success
    ? and(eq(recipients.jobId, job.id), eq(recipients.kind, kind.data))
    : eq(recipients.jobId, job.id);

  const rows = await db.select().from(recipients).where(where);
  return NextResponse.json({ recipients: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const job = await getJobOr404(slug);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const parsed = create.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const [row] = await db.insert(recipients)
    .values({ jobId: job.id, name: parsed.data.name, phone: parsed.data.phone, kind: parsed.data.kind ?? 'project' })
    .returning();
  return NextResponse.json({ recipient: row }, { status: 201 });
}
