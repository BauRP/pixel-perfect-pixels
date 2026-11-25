/** Conservative preflight for encrypted Safe imports on a shared disk.
 * Unknown space is handled by the ordinary filesystem error/rollback path.
 * Files are still individually encrypted, and originals are never touched
 * by this guard. The reserve covers AES-GCM overhead and metadata writes. */
export function safeImportHasSpace(freeBytes: number | null, fileSizes: readonly number[]): boolean {
  if (freeBytes === null) return true;
  if (!Number.isSafeInteger(freeBytes) || freeBytes < 0) return true;
  const RESERVE_BYTES = 1024 * 1024;
  const PER_FILE_OVERHEAD_BYTES = 4096;
  let required = RESERVE_BYTES;
  for (const size of fileSizes) {
    if (!Number.isSafeInteger(size) || size < 0) return true;
    required += size + PER_FILE_OVERHEAD_BYTES;
    if (!Number.isSafeInteger(required)) return false;
    if (required > freeBytes) return false;
  }
  return true;
}
