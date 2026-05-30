import type { JobModule } from './types';
import { dataAnnotation } from './data-annotation';

export const jobRegistry: JobModule[] = [dataAnnotation];

export function getJob(slug: string): JobModule | undefined {
  return jobRegistry.find(j => j.slug === slug);
}
