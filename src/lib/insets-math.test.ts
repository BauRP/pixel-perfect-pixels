import { describe, expect, it } from "vitest";
import { normalizeSystemInsets, navReserveHeight } from "./insets-math";

describe("Android 7–17 system area calculations", () => {
  it("keeps all three-button nav and status bar regions", () => {
    expect(normalizeSystemInsets({ top: 24, bottom: 48, left: 0, right: 0 })).toEqual({
      top: 24, bottom: 48, left: 0, right: 0, keyboardVisible: false,
    });
  });
  it("reserves only the small gesture strip when navigation changes", () => {
    expect(normalizeSystemInsets({ top: 24, bottom: 16 })).toMatchObject({ bottom: 16 });
  });
  it("supports landscape navigation bars and hardware cutouts", () => {
    expect(normalizeSystemInsets({ top: 0, bottom: 0, left: 42, right: 12 }))
      .toMatchObject({ left: 42, right: 12 });
  });
  it("accepts keyboard state and does not report NaN or negative sizes", () => {
    expect(normalizeSystemInsets({top: NaN, bottom: -4, left: Infinity,
      right: 25.25, keyboardVisible: true})).toEqual({
      top: 0, bottom: 0, left: 0, right: 26, keyboardVisible: true,
    });
  });
  it("recalculates gesture/button safe zones after switching navigation modes", () => {
    expect(normalizeSystemInsets({top: 24, bottom: 54}).bottom).toBe(54);
    expect(normalizeSystemInsets({top: 24, bottom: 18}).bottom).toBe(18);
  });
  it("never leaves extra navigation gap while the keyboard is open", () => {
    expect(navReserveHeight(58, true)).toBe(0);
    expect(navReserveHeight(58, false)).toBe(58);
  });
  it("recalculates navigation reserve when font scaling changes the tab bar", () => {
    expect(navReserveHeight(58, false)).toBe(58);
    expect(navReserveHeight(76, false)).toBe(76);
    expect(navReserveHeight(-10, false)).toBe(0);
    expect(navReserveHeight(NaN, false)).toBe(0);
  });
  it("handles absent snapshot during an early cold launch", () => {
    expect(normalizeSystemInsets(undefined)).toEqual({
      top: 0, bottom: 0, left: 0, right: 0, keyboardVisible: false,
    });
  });
});
