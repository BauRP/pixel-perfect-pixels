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
