import { describe, expect, it } from "vitest";
import { resolveAdaptiveGridColumns as resolve } from "./adaptive-grid-columns";
describe("Responsive gallery folder columns", () => {
  it("preserves the preferred number on adequate real Android viewports", () => {
    expect(resolve(3, 360)).toBe(3);
    expect(resolve(4, 800)).toBe(4);
    expect(resolve(2, 320)).toBe(2);
    expect(resolve(1, 320)).toBe(1);
  });
  it("reduces columns in split-screen and very small multiwindow modes", () => {
    expect(resolve(4, 320)).toBe(2);
    expect(resolve(3, 200)).toBe(1);
    expect(resolve(3, 240)).toBe(2);
    expect(resolve(4, 138)).toBe(1);
    expect(resolve(4, 360)).toBe(3);
  });
  it("restores preferred columns when expanded without mutating preferences", () => {
    expect(resolve(5, 320)).toBe(2);
    expect(resolve(5, 1024)).toBe(5);
  });
  it("does not guess before first browser frame and rejects invalid counts", () => {
    expect(resolve(4, 0)).toBe(4);
    expect(resolve(Number.NaN, 320)).toBe(2);
    expect(resolve(0, 320)).toBe(1);
    expect(resolve(2, Number.NaN)).toBe(2);
  });
});
