/** Compute album sort keys with constant extra memory.
 * Never spread all photo timestamps into Math.min/Math.max: a real Camera
 * album with >100k media can exceed the JS function-argument limit and
 * crash the entire gallery before any grid or thumbnail becomes visible.
 */
export function measureAlbumForSort(
  items: readonly { mtime?: number; size?: number }[],
): { createdAt: number; mtime: number; size: number } {
  let oldest = Infinity;
  let newest = -Infinity;
  let size = 0;
  for (const item of items) {
    const time = item.mtime;
    if (typeof time === "number" && Number.isFinite(time)) {
      if (time < oldest) oldest = time;
      if (time > newest) newest = time;
    }
    const bytes = item.size;
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) {
      size += bytes;
    }
  }
  return {
    createdAt: oldest === Infinity ? 0 : oldest,
    mtime: newest === -Infinity ? 0 : newest,
    size,
  };
}
