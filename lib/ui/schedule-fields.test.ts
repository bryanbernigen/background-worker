import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCHEDULE_FIELDS, scheduleFieldsToPayload, scheduleFieldsToSettings, scheduleFieldsFromJob,
} from './schedule-fields';

describe('scheduleFieldsToPayload', () => {
  it('window', () => {
    expect(scheduleFieldsToPayload({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'window' }))
      .toEqual({ type: 'window', minIntervalS: 600, maxIntervalS: 1800, dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7 });
  });
  it('interval', () => {
    expect(scheduleFieldsToPayload({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'interval', intervalS: 300 }))
      .toEqual({ type: 'interval', intervalS: 300 });
  });
  it('cron', () => {
    expect(scheduleFieldsToPayload({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'cron', cronExpr: '0 9 * * *', tzOffsetH: 7 }))
      .toEqual({ type: 'cron', cronExpr: '0 9 * * *', tzOffsetH: 7 });
  });
});

describe('scheduleFieldsToSettings', () => {
  it('interval nulls cron', () => {
    expect(scheduleFieldsToSettings({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'interval', intervalS: 120 }))
      .toMatchObject({ scheduleType: 'interval', intervalS: 120, cronExpr: null });
  });
  it('cron nulls interval', () => {
    expect(scheduleFieldsToSettings({ ...DEFAULT_SCHEDULE_FIELDS, scheduleType: 'cron', cronExpr: '*/5 * * * *' }))
      .toMatchObject({ scheduleType: 'cron', cronExpr: '*/5 * * * *', intervalS: null });
  });
});

describe('scheduleFieldsFromJob', () => {
  it('seeds defaults for null interval/cron', () => {
    const s = scheduleFieldsFromJob({
      scheduleType: 'window', minIntervalS: 600, maxIntervalS: 1800,
      dayStartHour: 7, dayEndHour: 23, tzOffsetH: 7, intervalS: null, cronExpr: null,
    });
    expect(s.scheduleType).toBe('window');
    expect(s.intervalS).toBe(300);
    expect(s.cronExpr).toBe('0 9 * * *');
  });
});
