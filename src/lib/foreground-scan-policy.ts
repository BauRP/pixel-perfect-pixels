/** Foreground-only MediaStore reads: a timer scheduled while the app
 * was visible must not start a long scan after Android backgrounds the UI. */
export function mayStartDeferredScan(visibility: DocumentVisibilityState): boolean {
  return visibility === "visible";
}
