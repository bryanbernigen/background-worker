import type { PaidItem } from '../types';

export interface DiffResult {
  newItems: PaidItem[];
  removedIds: string[];
}

export function diffItems(current: PaidItem[], previous: PaidItem[]): DiffResult {
  const prevIds = new Set(previous.map(i => i.id));
  const currIds = new Set(current.map(i => i.id));

  const newItems = current.filter(i => !prevIds.has(i.id));
  const removedIds = previous.filter(i => !currIds.has(i.id)).map(i => i.id);

  return { newItems, removedIds };
}
