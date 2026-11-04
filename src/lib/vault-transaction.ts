/**
 * A failed persistence write must never change the in-memory index. Any
 * caller deleting encrypted files can safely start disk deletion only
 * after this function returns successfully.
 */
export function commitStateAfterPersistence<T>(
  current: T,
  mutate: (current: T) => T,
  persist: (next: T) => void,
): T {
  const next = mutate(current);
  persist(next);
  return next;
}
