/** Verify native Android public-media publication receipts before allowing
 * the encrypted Safe original to be removed from the index. A path inside
 * app-private Android/data or Android/obb is not a public restore receipt. */
export function isPublishedMediaDestination(path: unknown): path is string {
  if (typeof path !== "string" || !path || /[\x00-\x1f\x7f]/.test(path)) return false;
  if (/^content:\/\/media\/external(?:_[A-Za-z0-9_-]+)?\/(?:images|video)\/media\/[1-9][0-9]*$/.test(path))
    return true;
  if (!/^\/(?:storage|sdcard|mnt\/sdcard)\//.test(path)) return false;
  if (path.endsWith("/") || path.includes("//") || path.includes("\\") ||
      path.split("/").some(part => part === "." || part === "..")) return false;
  const parts = path.split("/");
  if (parts.some((part, index) => part === "Android" &&
      (parts[index + 1] === "data" || parts[index + 1] === "obb"))) return false;
  return true;
}
