import type { PaidItem } from '@/lib/jobs/types';

export function diffNewItems(current: PaidItem[], lastSuccessful: PaidItem[]): PaidItem[] {
  const prev = new Set(lastSuccessful.map(i => i.id));
  return current.filter(i => !prev.has(i.id));
}
