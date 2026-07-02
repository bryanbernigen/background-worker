import { describe, it, expect } from 'vitest';
import { filterJobs } from './filter-jobs';

const jobs = [
  { slug: 'da-main', title: 'Data Annotation', type: 'data-annotation' },
  { slug: 'scraper-2', title: 'Nightly Scraper', type: 'data-annotation' },
];

describe('filterJobs', () => {
  it('returns all for an empty query', () => {
    expect(filterJobs(jobs, '')).toHaveLength(2);
    expect(filterJobs(jobs, '   ')).toHaveLength(2);
  });
  it('matches title case-insensitively', () => {
    expect(filterJobs(jobs, 'nightly').map(j => j.slug)).toEqual(['scraper-2']);
  });
  it('matches slug and type', () => {
    expect(filterJobs(jobs, 'da-main').map(j => j.slug)).toEqual(['da-main']);
    expect(filterJobs(jobs, 'annotation')).toHaveLength(2);
  });
  it('returns none when nothing matches', () => {
    expect(filterJobs(jobs, 'zzz')).toEqual([]);
  });
});
