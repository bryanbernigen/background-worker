import type { JobModule } from './types';

export const jobRegistry: JobModule[] = [];

export function getJob(slug: string): JobModule | undefined {
  return jobRegistry.find(j => j.slug === slug);
}
