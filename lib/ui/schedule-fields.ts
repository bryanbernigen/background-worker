import type { ScheduleType } from '@/lib/scheduler/window';

export interface ScheduleFieldsState {
  scheduleType: ScheduleType;
  minIntervalS: number;
  maxIntervalS: number;
  dayStartHour: number;
  dayEndHour: number;
  tzOffsetH: number;
  intervalS: number;
  cronExpr: string;
}

export const DEFAULT_SCHEDULE_FIELDS: ScheduleFieldsState = {
  scheduleType: 'window',
  minIntervalS: 600, maxIntervalS: 1800,
  dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7,
  intervalS: 300, cronExpr: '0 9 * * *',
};

export type SchedulePayload =
  | { type: 'window'; minIntervalS: number; maxIntervalS: number; dayStartHour: number; dayEndHour: number; tzOffsetH: number }
  | { type: 'interval'; intervalS: number }
  | { type: 'cron'; cronExpr: string; tzOffsetH: number };

export function scheduleFieldsToPayload(s: ScheduleFieldsState): SchedulePayload {
  if (s.scheduleType === 'interval') return { type: 'interval', intervalS: s.intervalS };
  if (s.scheduleType === 'cron') return { type: 'cron', cronExpr: s.cronExpr, tzOffsetH: s.tzOffsetH };
  return {
    type: 'window',
    minIntervalS: s.minIntervalS, maxIntervalS: s.maxIntervalS,
    dayStartHour: s.dayStartHour, dayEndHour: s.dayEndHour, tzOffsetH: s.tzOffsetH,
  };
}

export function scheduleFieldsToSettings(s: ScheduleFieldsState): Record<string, unknown> {
  const base = { scheduleType: s.scheduleType, tzOffsetH: s.tzOffsetH };
  if (s.scheduleType === 'interval') return { ...base, intervalS: s.intervalS, cronExpr: null };
  if (s.scheduleType === 'cron') return { ...base, cronExpr: s.cronExpr, intervalS: null };
  return {
    ...base,
    minIntervalS: s.minIntervalS, maxIntervalS: s.maxIntervalS,
    dayStartHour: s.dayStartHour, dayEndHour: s.dayEndHour,
  };
}

export function scheduleFieldsFromJob(job: {
  scheduleType: string; minIntervalS: number; maxIntervalS: number;
  dayStartHour: number; dayEndHour: number; tzOffsetH: number;
  intervalS: number | null; cronExpr: string | null;
}): ScheduleFieldsState {
  return {
    scheduleType: job.scheduleType as ScheduleType,
    minIntervalS: job.minIntervalS, maxIntervalS: job.maxIntervalS,
    dayStartHour: job.dayStartHour, dayEndHour: job.dayEndHour, tzOffsetH: job.tzOffsetH,
    intervalS: job.intervalS ?? DEFAULT_SCHEDULE_FIELDS.intervalS,
    cronExpr: job.cronExpr ?? DEFAULT_SCHEDULE_FIELDS.cronExpr,
  };
}
