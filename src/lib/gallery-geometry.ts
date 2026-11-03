export type GalleryLayoutEvidence = {
  viewportWidth: number; viewportHeight: number;
  navBottom: number; navWidth: number; navHeight: number;
  navInnerBottom: number; navInnerLeft: number; navInnerRight: number;
  links: number; minLinkWidth: number; minLinkHeight: number;
  maxLinkBottom: number; minLinkLeft: number; maxLinkRight: number;
  contentTop: number; safeTop: number;
  nativeInsetsReady: boolean; imeOpen: boolean;
  layoutIssue?: string;
};
/**
 * Assert actual React control geometry against Android's measured usable
 * viewport, not guesses based on device brand, DPI or navigation mode.
 * Native instrumentation receives this verdict as part of UI readiness.
 */
export function assessGalleryLayout(v: GalleryLayoutEvidence): string {
  const numbers = [
    v.viewportWidth,v.viewportHeight,v.navBottom,v.navWidth,v.navHeight,
    v.navInnerBottom,v.navInnerLeft,v.navInnerRight,v.minLinkWidth,
    v.minLinkHeight,v.maxLinkBottom,v.minLinkLeft,v.maxLinkRight,
    v.contentTop,v.safeTop,
  ];
  if (!numbers.every(Number.isFinite)) return "NON_FINITE_GEOMETRY";
  if (v.viewportWidth < 100 || v.viewportHeight < 100) return "UNMEASURED_VIEWPORT";
  if (v.imeOpen) return "TABS_HIDDEN_BY_KEYBOARD";
  if (v.links !== 3) return "MISSING_TABS";
  if (v.navWidth < 100 || v.navHeight < 36) return "NAV_NOT_VISIBLE";
  if (v.navBottom > v.viewportHeight + 3 || v.navBottom < 0) return "NAV_OUTSIDE_VIEWPORT";
  if (v.minLinkWidth <= 0 || v.minLinkHeight < 40) return "TINY_TAB_TARGET";
  if (v.maxLinkBottom > v.navInnerBottom + 3) return "TAB_OVERLAPS_SYSTEM_BAR";
  if (v.minLinkLeft < v.navInnerLeft - 3 ||
      v.maxLinkRight > v.navInnerRight + 3) return "TAB_OVERLAPS_SIDE_CUTOUT";
  if (v.contentTop < v.safeTop - 3) return "STATUS_BAR_OVERLAP";
  if (!v.nativeInsetsReady) return "NATIVE_INSETS_PENDING";
  return "OK";
}
