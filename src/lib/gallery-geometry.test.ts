import { describe, expect, it } from "vitest";
import { assessGalleryLayout, type GalleryLayoutEvidence } from "./gallery-geometry";

const baseline: GalleryLayoutEvidence = {
  viewportWidth: 360, viewportHeight: 780, navBottom: 780,
  navWidth: 360, navHeight: 108, navInnerBottom: 725,
  navInnerLeft: 0, navInnerRight: 360, links: 3,
  minLinkWidth: 108, minLinkHeight: 48, maxLinkBottom: 724,
  minLinkLeft: 12, maxLinkRight: 348, contentTop: 30,
  safeTop: 28, nativeInsetsReady: true, imeOpen: false,
};
const inspect = (changes: Partial<GalleryLayoutEvidence>) =>
  assessGalleryLayout({ ...baseline, ...changes });

describe("Nova Gallery actual Android bottom-nav geometry", () => {
  it("passes gesture, three-button, compact, tablet and landscape geometry", () => {
    expect(inspect({})).toBe("OK");
    expect(inspect({ navInnerBottom: 759, maxLinkBottom: 754, navHeight: 64 })).toBe("OK");
    expect(inspect({ viewportWidth: 320, viewportHeight: 480,
      navWidth: 320, navBottom: 480, navInnerBottom: 432,
      navInnerRight: 320, maxLinkBottom: 431, maxLinkRight: 310,
      minLinkWidth: 90 })).toBe("OK");
    expect(inspect({ viewportWidth: 1024, viewportHeight: 600,
      navWidth: 1024, navBottom: 600, navInnerBottom: 558,
      navInnerRight: 1024, maxLinkBottom: 557, maxLinkRight: 1000 })).toBe("OK");
  });
  it("respects side cutouts including landscape narrow bars", () => {
    expect(inspect({ navInnerLeft: 38, minLinkLeft: 41,
      navInnerRight: 336, maxLinkRight: 333 })).toBe("OK");
    expect(inspect({ navInnerLeft: 44, minLinkLeft: 21 })).toBe("TAB_OVERLAPS_SIDE_CUTOUT");
  });
  it("rejects status, gesture/button and window boundary overlaps", () => {
    expect(inspect({ navBottom: 800 })).toBe("NAV_OUTSIDE_VIEWPORT");
    expect(inspect({ maxLinkBottom: 744 })).toBe("TAB_OVERLAPS_SYSTEM_BAR");
    expect(inspect({ contentTop: 10 })).toBe("STATUS_BAR_OVERLAP");
    expect(inspect({ maxLinkRight: 390 })).toBe("TAB_OVERLAPS_SIDE_CUTOUT");
  });
  it("does not certify missing, tiny, keyboard-hidden or unmeasured tabs", () => {
    expect(inspect({ links: 2 })).toBe("MISSING_TABS");
    expect(inspect({ minLinkHeight: 47 })).toBe("TINY_TAB_TARGET");
    expect(inspect({ minLinkWidth: 47 })).toBe("TINY_TAB_TARGET");
    expect(inspect({ imeOpen: true })).toBe("TABS_HIDDEN_BY_KEYBOARD");
    expect(inspect({ nativeInsetsReady: false })).toBe("NATIVE_INSETS_PENDING");
    expect(inspect({ navWidth: Number.NaN })).toBe("NON_FINITE_GEOMETRY");
  });
});

import { nativeRouteUsesPersistentFrame } from "./native-route-frame";

describe("persistent Android root frame", () => {
  it("keeps native navigation visible across gallery, Safe and settings routes", () => {
    expect(nativeRouteUsesPersistentFrame("/")).toBe(true);
    expect(nativeRouteUsesPersistentFrame("/gallery/Camera")).toBe(true);
    expect(nativeRouteUsesPersistentFrame("/safe")).toBe(true);
    expect(nativeRouteUsesPersistentFrame("/safe/Album")).toBe(true);
    expect(nativeRouteUsesPersistentFrame("/settings")).toBe(true);
  });
  it("keeps the full-screen privacy document independent", () => {
    expect(nativeRouteUsesPersistentFrame("/privacy")).toBe(false);
  });
});
