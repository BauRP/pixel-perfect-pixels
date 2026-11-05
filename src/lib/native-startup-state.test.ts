import { describe, it, expect } from "vitest";
import { nativeStartupState, type StartupSnapshot } from "./native-startup-state";

const baseline: StartupSnapshot = {
  isPrivacy: false, isErrorRecovery: false, hasGalleryContent: true,
  hasShell: true, hasBottomTabs: true, layoutPhase: "gallery-layout-ready",
};
const check = (x: Partial<StartupSnapshot>) => nativeStartupState({ ...baseline, ...x });
describe("Android offline startup readiness", () => {
  it("rejects route-only and tabs-only false success", () => {
    expect(check({ hasGalleryContent: false })).toBe("waiting-for-route");
    expect(check({ hasBottomTabs: false })).toBe("waiting-for-shell");
    expect(check({ hasShell: false })).toBe("waiting-for-shell");
    expect(check({ layoutPhase: "react-root-committed" })).toBe("waiting-for-layout");
    expect(check({ layoutPhase: "router-load-resolved" })).toBe("waiting-for-layout");
  });
  it("certifies native gallery only after measured three-tab layout", () => {
    expect(check({})).toBe("ready");
  });
  it("keeps privacy and recovery independently reachable", () => {
    expect(check({ isPrivacy: true, hasGalleryContent: false,
      hasShell: false, hasBottomTabs: false, layoutPhase: "" })).toBe("ready");
    expect(check({ isErrorRecovery: true, hasGalleryContent: false,
      layoutPhase: "" })).toBe("error-recovery");
  });
});

describe("Native boot overlay must not hide an already visible gallery", () => {
  it("blocks only when the route or shell is missing", async () => {
    const { shouldShowBlockingBootOverlay: shouldShow } = await import("./native-startup-state");
    expect(shouldShow("waiting-for-route")).toBe(true);
    expect(shouldShow("waiting-for-shell")).toBe(true);
    expect(shouldShow("waiting-for-layout")).toBe(false);
    expect(shouldShow("ready")).toBe(false);
    expect(shouldShow("error-recovery")).toBe(false);
  });
});

describe("Native boot monitor loading overlay transitions", () => {
  it("releases the loading overlay while OS insets measurements settle", async () => {
    const { shouldShowBlockingBootOverlay } = await import("./native-startup-state");
    const timeline = ["waiting-for-route", "waiting-for-shell", "waiting-for-layout", "ready"] as const;
    expect(timeline.map(shouldShowBlockingBootOverlay)).toEqual([true, true, false, false]);
  });
});

describe("Android layout recovery avoids hiding an already rendered route", () => {
  it("offers a nonblocking retry only for an unverified layout", async () => {
    const { shouldOfferLayoutRetry } = await import("./native-startup-state");
    expect(shouldOfferLayoutRetry("waiting-for-layout")).toBe(true);
    for (const state of ["ready", "waiting-for-route", "waiting-for-shell", "error-recovery"] as const)
      expect(shouldOfferLayoutRetry(state)).toBe(false);
  });
});
