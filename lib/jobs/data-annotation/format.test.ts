import { describe, it, expect } from 'vitest';
import { formatNotification } from './format';
import type { PaidItem } from '@/lib/jobs/types';

const item = (over: Partial<PaidItem>): PaidItem => ({
  id: 'x', name: 'X', pay: '$10', availableTasksFor: '5', created: '', qualification: false, ...over,
});

describe('formatNotification', () => {
  it('includes paid projects', () => {
    const msg = formatNotification([item({ name: 'Paid Proj', pay: '$20/hr' })]);
    expect(msg).toContain('Paid Proj');
    expect(msg).toContain('$20/hr');
  });

  it('includes unpaid projects (no $ in pay)', () => {
    const msg = formatNotification([item({ name: 'Unpaid Proj', pay: '' })]);
    expect(msg).toContain('Unpaid Proj');
  });

  it('includes qualifications regardless of pay', () => {
    const msg = formatNotification([
      item({ name: 'Free Qual', pay: '', qualification: true }),
      item({ name: 'Paid Qual', pay: '$5', qualification: true }),
    ]);
    expect(msg).toContain('Free Qual');
    expect(msg).toContain('Paid Qual');
  });
});
