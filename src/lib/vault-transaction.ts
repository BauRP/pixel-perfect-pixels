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
  // Every persisted Safe record produced by this app contains a folders
  // array, including an intentionally empty Safe. A truncated but valid JSON
  // object ("{}" or only theme preferences) is NOT evidence that existing
  // encrypted files were removed. Refuse writes instead of replacing the
  // missing index with an empty one from the defaults.
  if (!Array.isArray(fields.folders))
    throw new Error("Missing or invalid Safe folder index");
  if (fields.folders.some(f =>
      typeof f !== "object" || f === null || Array.isArray(f) ||
      typeof (f as { id?: unknown }).id !== "string" ||
      !(f as { id: string }).id ||
      !Array.isArray((f as { files?: unknown }).files)))
    throw new Error("Invalid Safe folder contents");
  const folderIds = fields.folders.map(f => (f as { id: string }).id);
  if (new Set(folderIds).size !== folderIds.length)
    throw new Error("Duplicate Safe folder identifiers");
  if (fields.crypto !== undefined && fields.crypto !== null &&
      (typeof fields.crypto !== "object" || Array.isArray(fields.crypto)))
    throw new Error("Invalid Safe crypto metadata");
  return { ...defaults, ...fields, unlocked: false } as T;
}
