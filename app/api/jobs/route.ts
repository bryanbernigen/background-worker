import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { jobs, recipients } from '@/lib/db/schema';
import { requireSession } from '@/lib/api/require-session';
import { getJob } from '@/lib/jobs/registry';
import { createJobSchema, buildJobInsert, CreateJobError } from '@/lib/jobs/create-job';
import { reschedule } from '@/lib/scheduler';

export async function POST(req: NextRequest) {
  const guard = await requireSession(); if (!guard.ok) return guard.res;

  const parsed = createJobSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const payload = parsed.data;

  const mod = getJob(payload.type);
  if (!mod) return NextResponse.json({ error: `unknown job type '${payload.type}'` }, { status: 400 });

  const existing = await db.select({ slug: jobs.slug }).from(jobs);
  let built;
  try { built = buildJobInsert(payload, mod, existing.map(r => r.slug)); }
  catch (e) {
    if (e instanceof CreateJobError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const [row] = await db.insert(jobs).values(built.job).returning();
  if (built.recipients.length) {
    await db.insert(recipients).values(built.recipients.map(r => ({ jobId: row.id, ...r })));
  }
  await reschedule(row.id); // arms timers if enabled; clears nextRunAt if not

  return NextResponse.json({ job: { id: row.id, slug: row.slug, type: row.type } }, { status: 201 });
}
