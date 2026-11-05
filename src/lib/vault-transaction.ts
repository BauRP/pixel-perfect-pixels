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

// Reject directory traversal before constructing private encrypted-file paths.
// Existing UUIDs and simple legacy alphanumeric IDs remain supported.
export function isSafeVaultId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function isSafeVaultBlobPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === "nova_vault" &&
    isSafeVaultId(parts[1]) && /^[A-Za-z0-9_-]{1,128}\.enc$/.test(parts[2]);
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
      !isSafeVaultId((f as { id?: unknown }).id) ||
      !Array.isArray((f as { files?: unknown }).files)))
    throw new Error("Invalid Safe folder contents");
  const folderIds = fields.folders.map(f => (f as { id: string }).id);
  const fileIds = new Set<string>();
  for (const folder of fields.folders as Array<{ id: string; files: unknown[] }>) {
    for (const file of folder.files) {
      if (typeof file !== "object" || file === null || Array.isArray(file))
        throw new Error("Invalid Safe file entry");
      const item = file as Record<string, unknown>;
      if (!isSafeVaultId(item.id) || typeof item.iv !== "string" || !item.iv ||
          typeof item.name !== "string" ||
          (item.blobPath !== undefined && !isSafeVaultBlobPath(item.blobPath)) ||
          !(typeof item.cipher === "string" && item.cipher.length > 0) &&
          !(typeof item.blobPath === "string" && item.blobPath.length > 0))
        throw new Error("Invalid Safe encrypted file reference");
      if (item.blobPath &&
          item.blobPath !== `nova_vault/${folder.id}/${item.id}.enc`)
        throw new Error("Safe encrypted path does not match index");
      if (fileIds.has(item.id as string))
        throw new Error("Duplicate Safe file identifier");
      fileIds.add(item.id as string);
    }
  }
  if (new Set(folderIds).size !== folderIds.length)
    throw new Error("Duplicate Safe folder identifiers");
  if (fields.crypto !== undefined && fields.crypto !== null) {
    if (typeof fields.crypto !== "object" || Array.isArray(fields.crypto))
      throw new Error("Invalid Safe crypto metadata");
    const secrets = fields.crypto as Record<string, unknown>;
    if (!["salt", "wrappedKey", "wrapIv", "verifier", "verifierIv"].every(
      k => typeof secrets[k] === "string" && (secrets[k] as string).length > 0,
    ) || !Number.isFinite(secrets.iterations) || (secrets.iterations as number) <= 0)
      throw new Error("Incomplete Safe crypto metadata");
  }
  if (fileIds.size > 0 && (fields.crypto === undefined || fields.crypto === null))
    throw new Error("Safe encrypted files exist without keys");
  return { ...defaults, ...fields, unlocked: false } as T;
}
