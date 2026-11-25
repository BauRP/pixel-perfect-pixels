/** True private Safe capacity must be based on Android's free bytes,
 * not a hardcoded 5 GB limit that the application never enforced. */
export function safeStorageUsage(usedBytes: number, availableBytes: number | null):
  { capacityBytes: number; percent: number } | null {
  if (availableBytes === null || !Number.isFinite(availableBytes) ||
      !Number.isFinite(usedBytes) || usedBytes < 0 || availableBytes < 0)
    return null;
  const capacityBytes = usedBytes + availableBytes;
  if (!Number.isFinite(capacityBytes) || capacityBytes <= 0) return null;
  return { capacityBytes, percent: Math.min(100, usedBytes / capacityBytes * 100) };
}
