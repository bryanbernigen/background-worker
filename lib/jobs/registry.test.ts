import { describe, it, expect } from 'vitest';
import { getJob, listJobTypes } from './registry';

describe('getJob', () => {
  it('resolves a module by its type', () => {
    expect(getJob('data-annotation')?.type).toBe('data-annotation');
  });
  it('returns undefined for an unknown type', () => {
    expect(getJob('nope')).toBeUndefined();
  });
});

describe('listJobTypes', () => {
  it('returns the data-annotation type with its meta', () => {
    const types = listJobTypes();
    const da = types.find(t => t.type === 'data-annotation');
    expect(da).toBeDefined();
    expect(da!.defaultMeta.title).toBe('Data Annotation');
    expect(typeof da!.hasSettingsPanel).toBe('boolean');
  });
});
