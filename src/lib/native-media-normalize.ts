/** Accept only well-formed Android MediaStore metadata. A broken
 * provider row must never abort scanning every valid photograph. */
export type ValidNativeMedia = {
  uri: string; name: string; mime: string; relativePath: string;
  size: number; mtime: number;
};
export function normalizeNativeMedia(raw: unknown): ValidNativeMedia | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.uri !== "string" || !row.uri.startsWith("content://") ||
      typeof row.name !== "string" || !row.name.trim()) return null;
  const finite = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
  return {
    uri: row.uri, name: row.name,
    mime: typeof row.mime === "string" ? row.mime.trim() : "",
    relativePath: typeof row.relativePath === "string" ? row.relativePath : "",
    size: finite(row.size), mtime: finite(row.mtime),
  };
}
