import { z } from 'zod';
import { jobs } from '@/lib/db/schema';
import type { JobModule } from './types';
import { slugify, nextAvailableSlug } from './slug';
import { validateSchedule, type ScheduleCfg } from '@/lib/scheduler/window';

export class CreateJobError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; this.name = 'CreateJobError'; }
}

const scheduleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('window'),
    minIntervalS: z.number().int().min(30).max(86400),
    maxIntervalS: z.number().int().min(30).max(86400),
    dayStartHour: z.number().int().min(0).max(23),
    dayEndHour:   z.number().int().min(1).max(24),
    tzOffsetH:    z.number().int().min(-12).max(14),
  }),
  z.object({
    type: z.literal('interval'),
    intervalS: z.number().int().min(30).max(86400),
  }),
  z.object({
    type: z.literal('cron'),
    cronExpr:  z.string().min(1),
    tzOffsetH: z.number().int().min(-12).max(14),
  }),
]);

export const createJobSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  enabled: z.boolean().optional(),
  schedule: scheduleSchema,
  customSettings: z.unknown().optional(),
  recipients: z.array(z.object({
    name:  z.string().min(1),
    phone: z.string().min(5),
    tag:   z.string().optional(),
  })).optional(),
});
export type CreateJobPayload = z.infer<typeof createJobSchema>;

export function buildJobInsert(
  payload: CreateJobPayload,
  mod: JobModule,
  existingSlugs: string[],
): { job: typeof jobs.$inferInsert; recipients: { name: string; phone: string; tag: string | null }[] } {
  // slug
  let slug: string;
  if (payload.slug) {
    if (existingSlugs.includes(payload.slug)) throw new CreateJobError(`slug '${payload.slug}' already exists`, 409);
    slug = payload.slug;
  } else {
    slug = nextAvailableSlug(slugify(payload.name), existingSlugs);
  }

  // custom settings validated against the type's schema
  const customSettings = (payload.customSettings ?? {}) as Record<string, unknown>;
  if (mod.customSettingsSchema) {
    const r = mod.customSettingsSchema.safeParse(customSettings);
    if (!r.success) throw new CreateJobError(`invalid customSettings: ${r.error.issues.map(i => i.message).join('; ')}`);
  }

  // schedule → flat columns (unset window columns fall back to DB defaults)
  const s = payload.schedule;
  const scheduleCols: Partial<typeof jobs.$inferInsert> =
    s.type === 'window'
      ? { scheduleType: 'window', minIntervalS: s.minIntervalS, maxIntervalS: s.maxIntervalS,
          dayStartHour: s.dayStartHour, dayEndHour: s.dayEndHour, tzOffsetH: s.tzOffsetH,
          intervalS: null, cronExpr: null }
      : s.type === 'interval'
      ? { scheduleType: 'interval', intervalS: s.intervalS, cronExpr: null }
      : { scheduleType: 'cron', cronExpr: s.cronExpr, tzOffsetH: s.tzOffsetH, intervalS: null };

  // validate the resulting schedule (catches bad cron) using a fully-populated cfg
  const cfgForValidation: ScheduleCfg = {
    scheduleType: scheduleCols.scheduleType as ScheduleCfg['scheduleType'],
    minIntervalS: scheduleCols.minIntervalS ?? 600,
    maxIntervalS: scheduleCols.maxIntervalS ?? 1800,
    dayStartHour: scheduleCols.dayStartHour ?? 7,
    dayEndHour:   scheduleCols.dayEndHour ?? 23,
    tzOffsetH:    scheduleCols.tzOffsetH ?? 7,
    intervalS:    scheduleCols.intervalS ?? null,
    cronExpr:     scheduleCols.cronExpr ?? null,
  };
  try { validateSchedule(cfgForValidation); }
  catch (e) { throw new CreateJobError(e instanceof Error ? e.message : 'invalid schedule'); }

  const job: typeof jobs.$inferInsert = {
    slug,
    type: payload.type,
    title: payload.name,
    url: mod.defaultMeta.url,
    description: mod.defaultMeta.description,
    enabled: payload.enabled ?? true,
    customSettings,
    ...scheduleCols,
  };

  const recipients = (payload.recipients ?? []).map(r => ({ name: r.name, phone: r.phone, tag: r.tag ?? null }));
  return { job, recipients };
}
