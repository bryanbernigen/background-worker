import { describe, it, expect } from 'vitest';
import { getJob } from './registry';

describe('getJob', () => {
  it('resolves a module by its type', () => {
    expect(getJob('data-annotation')?.type).toBe('data-annotation');
  });
  it('returns undefined for an unknown type', () => {
    expect(getJob('nope')).toBeUndefined();
  });
});
