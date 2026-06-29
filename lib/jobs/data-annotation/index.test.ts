import { describe, it, expect } from 'vitest';
import { dataAnnotation } from './index';

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
