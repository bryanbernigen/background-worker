import { describe, it, expect } from 'vitest';
import { diffNewItems } from './diff';
import type { PaidItem } from '@/lib/jobs/types';

const item = (id: string, qual = false): PaidItem => ({
  id, name: id, pay: '$10', availableTasksFor: '5', created: '', qualification: qual,
});

describe('diffNewItems', () => {
  it('returns items present now but absent in last successful run', () => {
    const prev = [item('a')];
    const curr = [item('a'), item('b')];
    expect(diffNewItems(curr, prev).map(i => i.id)).toEqual(['b']);
  });

  it('returns nothing when current is a subset of previous', () => {
    expect(diffNewItems([item('a')], [item('a'), item('b')])).toEqual([]);
  });

  it('treats appear → disappear → reappear as NEW (spec rule)', () => {
    // last successful run contained only ['b']; current shows ['a','b']; 'a' was there before
    // its disappearance, but absent in the LAST SUCCESSFUL run, so it is new again.
    const lastSuccessful = [item('b')];
    const curr = [item('a'), item('b')];
    expect(diffNewItems(curr, lastSuccessful).map(i => i.id)).toEqual(['a']);
  });

  it('returns all current items when there is no previous successful run', () => {
    expect(diffNewItems([item('a'), item('b')], []).map(i => i.id)).toEqual(['a', 'b']);
  });
});
