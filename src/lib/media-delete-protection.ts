import type { ScannedItem } from "./device-scan";

/** Never pass a photo marked 'protected from deletion' to public MediaStore
 * deletion, including when the user selects protected and ordinary media
 * together. Keep the original items and selection IDs unchanged. */
export function partitionDeletableMedia<T extends Pick<ScannedItem, "id">>(
  items: readonly T[],
  isProtected: (id: string) => boolean,
): { allowed: T[]; protectedItems: T[] } {
  const allowed: T[] = [];
  const protectedItems: T[] = [];
  for (const item of items) {
    if (isProtected(item.id)) protectedItems.push(item);
    else allowed.push(item);
  }
  return { allowed, protectedItems };
}
