import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireViewer, requireAdmin } from '@/lib/access/role';
import { maskRecipient } from '@/lib/access/mask';

const tagSchema = z.enum(['new-task', 'cookie-expiry']);

const create = z.object({
  name:  z.string().min(1),
  phone: z.string().min(5),
  tag:   tagSchema.optional(),
});

async function getJobOr404(slug: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  return job ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireViewer(); if (!guard.ok) return guard.res;
  const { role } = guard;
  const { slug } = await params;
  const job = await getJobOr404(slug);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (role === 'guest' && !job.visibleToGuest) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  // Optional ?tag=new-task|cookie-expiry filter; omitted → all recipients.
  const tagParam = new URL(req.url).searchParams.get('tag');
  const tag = tagSchema.safeParse(tagParam);
  const where = tag.success
    ? and(eq(recipients.jobId, job.id), eq(recipients.tag, tag.data))
    : eq(recipients.jobId, job.id);

  const rows = await db.select().from(recipients).where(where);
  return NextResponse.json({ recipients: rows.map(r => maskRecipient(role, r)) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireAdmin(); if (!guard.ok) return guard.res;
  const { slug } = await params;
  const job = await getJobOr404(slug);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const parsed = create.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  const [row] = await db.insert(recipients)
    .values({ jobId: job.id, name: parsed.data.name, phone: parsed.data.phone, tag: parsed.data.tag ?? 'new-task' })
    .returning();
  return NextResponse.json({ recipient: row }, { status: 201 });
}
