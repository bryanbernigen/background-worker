import { describe, it, expect } from 'vitest';
import { slugify, nextAvailableSlug } from './slug';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Data Annotation Main!')).toBe('data-annotation-main');
  });
  it('trims leading/trailing dashes and falls back to "job"', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
    expect(slugify('!!!')).toBe('job');
  });
});

describe('nextAvailableSlug', () => {
  it('returns base when free', () => {
    expect(nextAvailableSlug('da', ['x', 'y'])).toBe('da');
  });
  it('suffixes -2, -3 on collision', () => {
    expect(nextAvailableSlug('da', ['da'])).toBe('da-2');
    expect(nextAvailableSlug('da', ['da', 'da-2'])).toBe('da-3');
  });
});
