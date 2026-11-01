import { describe, expect, it } from "vitest";
import { normalizeSystemInsets, navReserveHeight, scrollContentBottomReserve, fitInsetsToViewport, isMeasuredViewport } from "./insets-math";

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
  it("handles very tall displays without assuming a fixed aspect ratio", () => {
    expect(normalizeSystemInsets({ top: 31, bottom: 22, left: 0, right: 0 }))
      .toMatchObject({ top: 31, bottom: 22 });
  });
  it("handles split-screen caption bars and landscape cutouts together", () => {
    expect(normalizeSystemInsets({ top: 38, bottom: 0, left: 27, right: 0 }))
      .toMatchObject({ top: 38, bottom: 0, left: 27 });
  });
  it("does not double-count OS safe area below bottom navigation", () => {
    // 68 px includes a 16 px gesture region; the scroll region reserves 68, not 84.
    expect(scrollContentBottomReserve(68, false)).toBe(68);
    expect(scrollContentBottomReserve(92, false)).toBe(92);
    expect(scrollContentBottomReserve(92, true)).toBe(0);
  });
  it("supports switching between three-button and gesture navigation", () => {
    const buttons = normalizeSystemInsets({ top: 25, bottom: 50 });
    const gestures = normalizeSystemInsets({ top: 25, bottom: 18 });
    expect(buttons.top).toBe(gestures.top);
    expect(gestures.bottom).toBeLessThan(buttons.bottom);
    expect(scrollContentBottomReserve(81, false)).toBe(81);
  });
  it("keeps safe insets for side cutouts after rotation", () => {
    const rotated = normalizeSystemInsets({ top: 0, bottom: 24, left: 35, right: 9 });
    expect(rotated.left).toBe(35);
    expect(rotated.right).toBe(9);
  });
  it("keeps viewport-safe layout without adding device bottom padding twice", () => {
    const gestureInsets = normalizeSystemInsets({ top: 27, bottom: 20, left: 8, right: 8 });
    const buttonsInsets = normalizeSystemInsets({ top: 27, bottom: 54, left: 8, right: 8 });
    expect(gestureInsets.left).toBe(buttonsInsets.left);
    expect(gestureInsets.right).toBe(buttonsInsets.right);
    // Full measured tab height already includes the inset.
    expect(scrollContentBottomReserve(70, false)).toBe(70);
    expect(scrollContentBottomReserve(102, false)).toBe(102);
  });
  it("does not let keyboard-open state add navigation reserve", () => {
    const portrait = normalizeSystemInsets({top: 28, bottom: 56, keyboardVisible: false});
    const landscape = normalizeSystemInsets({top: 0, bottom: 26, left: 34, keyboardVisible: false});
    const keyboard = normalizeSystemInsets({top: 28, bottom: 56, keyboardVisible: true});
    expect(portrait.bottom).toBe(56);
    expect(landscape.left).toBe(34);
    expect(scrollContentBottomReserve(94, keyboard.keyboardVisible)).toBe(0);
  });
  it("does not overflow small split-screen windows with a tall status or nav bar", () => {
    const safe = normalizeSystemInsets({ top: 48, bottom: 56, left: 20, right: 20 });
    const compact = fitInsetsToViewport(safe, 30, 75);
    expect(compact.top + compact.bottom).toBeLessThanOrEqual(75);
    expect(compact.left + compact.right).toBeLessThanOrEqual(30);
    expect(compact.top).toBeGreaterThanOrEqual(0);
  });
  it("preserves exact system insets on normal portrait and landscape displays", () => {
    const safe = normalizeSystemInsets({ top: 28, bottom: 24, left: 13, right: 7 });
    expect(fitInsetsToViewport(safe, 360, 720)).toEqual(safe);
    expect(fitInsetsToViewport(safe, 720, 360)).toEqual(safe);
  });
  it("does not erase true system bars while the first WebView frame is unmeasured", () => {
    const insets = normalizeSystemInsets({top: 26, bottom: 48, left: 12, right: 0});
    expect(fitInsetsToViewport(insets, 0, 0)).toEqual(insets);
    expect(fitInsetsToViewport(insets, Number.NaN, -1)).toEqual(insets);
    expect(fitInsetsToViewport(insets, 0, 700)).toEqual(insets);
  });
  it("does not overrun landscape width when system nav is on the side", () => {
    const safe = normalizeSystemInsets({top: 24, bottom: 48, left: 35, right: 27});
    const actual = fitInsetsToViewport(safe, 50, 320);
    expect(actual.left + actual.right).toBeLessThanOrEqual(50);
    expect(actual.top + actual.bottom).toBeLessThanOrEqual(320);
  });
  it("distinguishes a first-frame unmeasured viewport from absent OS bars", () => {
    expect(isMeasuredViewport(0, 0)).toBe(false);
    expect(isMeasuredViewport(NaN, 400)).toBe(false);
    expect(isMeasuredViewport(360, 780)).toBe(true);
    expect(isMeasuredViewport(780, 360)).toBe(true);
  });
  it("handles absent snapshot during an early cold launch", () => {
    expect(normalizeSystemInsets(undefined)).toEqual({
      top: 0, bottom: 0, left: 0, right: 0, keyboardVisible: false,
    });
  });
});
