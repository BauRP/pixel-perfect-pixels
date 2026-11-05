export type StartupSnapshot = {
  isPrivacy: boolean;
  isErrorRecovery: boolean;
  hasGalleryContent: boolean;
  hasShell: boolean;
  hasBottomTabs: boolean;
  layoutPhase: string;
};

/**
 * Pure readiness policy. A route being mounted is NOT enough:
 * tests observed visible-route logs alongside completely black Android
 * screens. Gallery readiness requires the measured 3-tab native geometry,
 * whose own validation separately checks real Android WindowInsets.
 */
export function nativeStartupState(snapshot: StartupSnapshot):
  "ready" | "error-recovery" | "waiting-for-route" | "waiting-for-shell" | "waiting-for-layout" {
  if (snapshot.isErrorRecovery) return "error-recovery";
  if (snapshot.isPrivacy) return "ready";
  if (!snapshot.hasGalleryContent) return "waiting-for-route";
  if (!snapshot.hasShell || !snapshot.hasBottomTabs) return "waiting-for-shell";
  if (snapshot.layoutPhase !== "gallery-layout-ready") return "waiting-for-layout";
  return "ready";
}

/** A route can have DOM nodes but still fail native Android geometry. After
 * the startup timeout offer a NONBLOCKING retry, not a fullscreen overlay. */
export function shouldOfferLayoutRetry(
  state: ReturnType<typeof nativeStartupState>,
): boolean {
  return state === "waiting-for-layout";
}

/** Do not obscure a live gallery merely because the OS has not yet
 * delivered its first insets snapshot. Native watchdog tests geometry
 * independently; the full-screen recovery is reserved for a missing route. */
export function shouldShowBlockingBootOverlay(
  state: ReturnType<typeof nativeStartupState>,
): boolean {
  return state === "waiting-for-route" || state === "waiting-for-shell";
}
