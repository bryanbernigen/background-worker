import type { JobModule } from './types';
import { dataAnnotation } from './data-annotation';

export const jobRegistry: JobModule[] = [dataAnnotation];

export function getJob(type: string): JobModule | undefined {
  return jobRegistry.find(j => j.type === type);
}
