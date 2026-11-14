/** Fast, exact matching of removed media from a successful Android
 * deletion or Safe import. A content URI is kept verbatim; only file://
 * paths have their scheme removed as in the original scanner.
 *
 * For old filesystem operations the returned path can be absolute while
 * the gallery stores a relative path. Precompute slash-boundary suffixes
 * once instead of rebuilding/scanning the full removal list for EVERY
 * displayed photo (quadratic work with large folders).
 */
export type RemovableMedia = { path: string; nativeUri?: string };

const normalizePath = (path: string): string => path.replace(/^file:\/\//, "");

export function createRemovalMatcher(paths: readonly string[]): (item: RemovableMedia) => boolean {
  const exact = new Set<string>();
  const relativeSuffixes = new Set<string>();
  for (const original of paths) {
    const path = normalizePath(original);
    exact.add(path);
    // Old rule: a deleted absolute path ending in "/" + item.path also
    // matches. Materialize ONLY slash-boundary suffixes to keep it exact.
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      const suffix = path.slice(slash + 1);
      if (suffix) relativeSuffixes.add(suffix);
    }
  }
  return (item) =>
    exact.has(normalizePath(item.nativeUri ?? "")) ||
    exact.has(normalizePath(item.path)) ||
    relativeSuffixes.has(item.path);
}
