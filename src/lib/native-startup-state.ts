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
