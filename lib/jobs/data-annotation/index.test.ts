import { describe, it, expect } from 'vitest';
import { dataAnnotation, formatDaSummary } from './index';

describe('formatDaSummary', () => {
  it('formats projects + qualifications as paid/total (+newPaid/+newAll)', () => {
    const s = formatDaSummary({
      paidProjects: 2, allProjects: 5, paidQualifications: 1, allQualifications: 3,
      newPaidProjects: 1, newAllProjects: 2, newPaidQualifications: 0, newAllQualifications: 1,
      items: [],
    });
    expect(s).toBe('projects: 2/5 (+1/+2)\nqualifications: 1/3 (+0/+1)');
  });
});

describe('dataAnnotation module shape', () => {
  it('is registered under type data-annotation with a run()', () => {
    expect(dataAnnotation.type).toBe('data-annotation');
    expect(typeof dataAnnotation.run).toBe('function');
  });

  it('errors with a summary (not counters) when no cookie configured', async () => {
    const res = await dataAnnotation.run({
      jobId: 1,
      meta: dataAnnotation.defaultMeta,
      custom: {},                 // no cookie_encrypted
      db: {} as never,
      recipients: [],
      lastSuccessful: null,
      notify: async () => false,
    });
    expect(res.status).toBe('error');
    expect(res.notificationSent).toBe(false);
    expect(res.summary).toMatch(/cookie/i);
  });
});
