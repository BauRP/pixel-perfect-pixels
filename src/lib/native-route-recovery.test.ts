import { describe, expect, it } from "vitest";
import { shouldRetryNativeRoute } from "./native-route-recovery";

describe("Android first route retry safety", () => {
  const stalled = { visible: true, hasRoute: false, hasPrivacy: false, hasRecovery: false };
  it("permits one bounded retry for a missing first route", () => {
    expect(shouldRetryNativeRoute(stalled)).toBe(true);
  });
  it("never retries during ordinary gallery use, privacy, recovery, or background", () => {
    expect(shouldRetryNativeRoute({...stalled, hasRoute:true})).toBe(false);
    expect(shouldRetryNativeRoute({...stalled, hasPrivacy:true})).toBe(false);
    expect(shouldRetryNativeRoute({...stalled, hasRecovery:true})).toBe(false);
    expect(shouldRetryNativeRoute({...stalled, visible:false})).toBe(false);
  });
});
