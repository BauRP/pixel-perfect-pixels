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

// Never silently replace malformed Safe metadata with an empty index.
export function parseVaultMetadata<T extends { folders: unknown[]; unlocked: boolean }>(
  raw: string, defaults: T,
): T {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Invalid Safe metadata");
  const fields = parsed as Record<string, unknown>;
  if ("folders" in fields && !Array.isArray(fields.folders))
    throw new Error("Invalid Safe folder index");
  if (Array.isArray(fields.folders) &&
      fields.folders.some(f => typeof f !== "object" || f === null ||
        !Array.isArray((f as { files?: unknown }).files)))
    throw new Error("Invalid Safe folder contents");
  if (fields.crypto !== undefined && fields.crypto !== null &&
      (typeof fields.crypto !== "object" || Array.isArray(fields.crypto)))
    throw new Error("Invalid Safe crypto metadata");
  return { ...defaults, ...fields, unlocked: false } as T;
}
