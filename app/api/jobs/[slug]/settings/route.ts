import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/access/role';
import { encrypt } from '@/lib/crypto';
import { getJob } from '@/lib/jobs/registry';
import { reschedule, runManual } from '@/lib/scheduler';
import { validateSchedule, type ScheduleCfg } from '@/lib/scheduler/window';

const metaSchema = z.object({
  title:       z.string().min(1).optional(),
  url:         z.string().url().optional(),
  description: z.string().optional(),
}).strict();

const scheduleSchema = z.object({
  scheduleType: z.enum(['window', 'interval', 'cron']).optional(),
  intervalS:    z.number().int().min(30).max(86400).nullable().optional(),
  cronExpr:     z.string().min(1).nullable().optional(),
  minIntervalS: z.number().int().min(30).max(86400).optional(),
  maxIntervalS: z.number().int().min(30).max(86400).optional(),
  dayStartHour: z.number().int().min(0).max(23).optional(),
  dayEndHour:   z.number().int().min(1).max(24).optional(),
  tzOffsetH:    z.number().int().min(-12).max(14).optional(),
  enabled:      z.boolean().optional(),
}).strict();

const bodySchema = z.object({
  meta:     metaSchema.optional(),
  schedule: scheduleSchema.optional(),
  custom:   z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.res;
  const { slug } = await params;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const [job] = await db.select().from(jobs).where(eq(jobs.slug, slug)).limit(1);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const mod = getJob(slug);
  if (!mod) return NextResponse.json({ error: 'no registered module' }, { status: 500 });

  let newCustom = job.customSettings as Record<string, unknown>;
  if (body.custom) {
    // Per-job transforms: a `cookie` key is encrypted into `cookie_encrypted`.
    const incoming: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.custom)) {
      if (k === 'cookie' && typeof v === 'string') {
        // New cookie: store it and clear all derived expiry state. The
        // immediate validation run below repopulates expires_at/checked_at.
        incoming.cookie_encrypted  = encrypt(v);
        incoming.cookie_warned     = false;
        incoming.cookie_invalid    = false;
        incoming.cookie_expires_at = null;
        incoming.cookie_checked_at = null;
      } else {
        incoming[k] = v;
      }
    }
    newCustom = { ...newCustom, ...incoming };

    if (mod.customSettingsSchema) {
      const r = mod.customSettingsSchema.safeParse(newCustom);
      if (!r.success) return NextResponse.json({ error: r.error.issues }, { status: 400 });
    }
  }

  const mergedCfg: ScheduleCfg = {
    scheduleType: (body.schedule?.scheduleType ?? job.scheduleType) as ScheduleCfg['scheduleType'],
    minIntervalS: body.schedule?.minIntervalS ?? job.minIntervalS,
    maxIntervalS: body.schedule?.maxIntervalS ?? job.maxIntervalS,
    dayStartHour: body.schedule?.dayStartHour ?? job.dayStartHour,
    dayEndHour:   body.schedule?.dayEndHour   ?? job.dayEndHour,
    tzOffsetH:    body.schedule?.tzOffsetH    ?? job.tzOffsetH,
    intervalS:    body.schedule?.intervalS    ?? job.intervalS,
    cronExpr:     body.schedule?.cronExpr     ?? job.cronExpr,
  };
  try { validateSchedule(mergedCfg); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid schedule' }, { status: 400 }); }

  await db.update(jobs).set({
    ...(body.meta ?? {}),
    ...(body.schedule ?? {}),
    customSettings: newCustom,
    updatedAt: new Date(),
  }).where(eq(jobs.id, job.id));

  // When a new cookie was provided, immediately validate it: this confirms the
  // cookie works and captures the real session expiry right away (it also
  // re-arms the expiry-warning timer via runManual → armExpiryTimer).
  const cookieProvided = typeof body.custom?.cookie === 'string';
  if (cookieProvided) {
    try { await runManual(job.id); }
    catch (e) { console.error('[settings] cookie validation run failed', e); }
  }

  await reschedule(job.id);

  return NextResponse.json({ ok: true });
}
