/**
 * Android has one persistent system-safe AppShell around route content.
 * The website preserves its existing individual route frames.
 * The privacy document is intentionally full-screen without gallery tabs.
 */
export function nativeRouteUsesPersistentFrame(pathname: string): boolean {
  return pathname !== "/privacy";
}
