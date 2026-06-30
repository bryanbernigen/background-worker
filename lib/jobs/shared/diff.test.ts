import { describe, it, expect } from 'vitest';
import { diffNewItems } from './diff';

const item = (id: string) => ({ id, name: id });

describe('diffNewItems (generic)', () => {
  it('returns items present now but absent in the previous set', () => {
    expect(diffNewItems([item('a'), item('b')], [item('a')], i => i.id).map(i => i.id)).toEqual(['b']);
  });
  it('returns nothing when current is a subset of previous', () => {
    expect(diffNewItems([item('a')], [item('a'), item('b')], i => i.id)).toEqual([]);
  });
  it('treats reappearance (absent in previous) as new', () => {
    expect(diffNewItems([item('a'), item('b')], [item('b')], i => i.id).map(i => i.id)).toEqual(['a']);
  });
  it('returns all current items when previous is empty', () => {
    expect(diffNewItems([item('a'), item('b')], [], i => i.id).map(i => i.id)).toEqual(['a', 'b']);
  });
});
