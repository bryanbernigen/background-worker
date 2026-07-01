import { describe, it, expect } from 'vitest';
import { createJobSchema, buildJobInsert, CreateJobError } from './create-job';
import { dataAnnotation } from './data-annotation';

const da = dataAnnotation;

function payload(over: Record<string, unknown> = {}) {
  return createJobSchema.parse({
    type: 'data-annotation',
    name: 'DA Main',
    schedule: { type: 'interval', intervalS: 300 },
    ...over,
  });
}

describe('buildJobInsert', () => {
  it('maps an interval schedule + derives slug + title from name', () => {
    const { job, recipients } = buildJobInsert(payload(), da, []);
    expect(job.type).toBe('data-annotation');
    expect(job.slug).toBe('da-main');
    expect(job.title).toBe('DA Main');
    expect(job.url).toBe(da.defaultMeta.url);
    expect(job.scheduleType).toBe('interval');
    expect(job.intervalS).toBe(300);
    expect(job.cronExpr).toBeNull();
    expect(job.enabled).toBe(true);
    expect(recipients).toEqual([]);
  });

  it('suffixes the slug on collision', () => {
    const { job } = buildJobInsert(payload(), da, ['da-main']);
    expect(job.slug).toBe('da-main-2');
  });

  it('honors an explicit slug and 409s when taken', () => {
    expect(buildJobInsert(payload({ slug: 'custom' }), da, []).job.slug).toBe('custom');
    expect(() => buildJobInsert(payload({ slug: 'custom' }), da, ['custom'])).toThrow(CreateJobError);
  });

  it('maps a cron schedule', () => {
    const { job } = buildJobInsert(payload({ schedule: { type: 'cron', cronExpr: '0 9 * * *', tzOffsetH: 7 } }), da, []);
    expect(job.scheduleType).toBe('cron');
    expect(job.cronExpr).toBe('0 9 * * *');
    expect(job.tzOffsetH).toBe(7);
    expect(job.intervalS).toBeNull();
  });

  it('maps a window schedule', () => {
    const { job } = buildJobInsert(payload({ schedule: {
      type: 'window', minIntervalS: 600, maxIntervalS: 1800, dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7,
    } }), da, []);
    expect(job.scheduleType).toBe('window');
    expect(job.minIntervalS).toBe(600);
    expect(job.dayEndHour).toBe(23);
  });

  it('rejects an invalid cron via CreateJobError', () => {
    expect(() => buildJobInsert(payload({ schedule: { type: 'cron', cronExpr: 'nope', tzOffsetH: 7 } }), da, []))
      .toThrow(CreateJobError);
  });

  it('rejects customSettings that fail the type schema', () => {
    // DA's schema expects cookie_expires_at to be number|null; a string fails.
    expect(() => buildJobInsert(payload({ customSettings: { cookie_expires_at: 'soon' } }), da, []))
      .toThrow(CreateJobError);
  });

  it('passes recipients through with tag defaulting to null', () => {
    const { recipients } = buildJobInsert(payload({ recipients: [{ name: 'A', phone: '628111', tag: 'new-task' }, { name: 'B', phone: '628222' }] }), da, []);
    expect(recipients).toEqual([
      { name: 'A', phone: '628111', tag: 'new-task' },
      { name: 'B', phone: '628222', tag: null },
    ]);
  });
});
