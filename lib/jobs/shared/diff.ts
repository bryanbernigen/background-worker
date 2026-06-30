/** Items in `current` whose key is absent from `previous`. Key identity decides "new". */
export function diffNewItems<T>(current: T[], previous: T[], keyFn: (item: T) => string): T[] {
  const prev = new Set(previous.map(keyFn));
  return current.filter(i => !prev.has(keyFn(i)));
}
