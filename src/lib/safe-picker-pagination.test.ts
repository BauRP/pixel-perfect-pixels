import { describe, expect, it } from "vitest";
import { nextSafePickerPage, liveSafePickerIds } from "./safe-picker-pagination";

describe("large Safe gallery picker", () => {
  it("makes 2500 items accessible without skipping or reordering", () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    let seen = all.slice(0, 90);
    let count = 90;
    while (count < all.length) {
      const next = nextSafePickerPage(all.length, count);
      seen = seen.concat(all.slice(count, next));
      count = next;
    }
    expect(seen).toEqual(all);
  });
  it("respects empty, smaller and invalid album sizes", () => {
    expect(nextSafePickerPage(0, 90)).toBe(0);
    expect(nextSafePickerPage(28, 90)).toBe(28);
    expect(nextSafePickerPage(120, 90)).toBe(120);
    expect(nextSafePickerPage(200, -1)).toBe(90);
    expect(nextSafePickerPage(5000, 90, 90)).toBe(180);
    expect(nextSafePickerPage(5000, 180, 90)).toBe(270);
    expect(nextSafePickerPage(5000, 4990, 90)).toBe(5000);
  });
});


describe("Safe picker selection after gallery refresh", () => {
  it("does not confirm media whose access was revoked or which were removed", () => {
    const ids = liveSafePickerIds(new Set(["old", "new", "also-new"]), new Set(["new", "also-new"]));
    expect([...ids]).toEqual(["new", "also-new"]);
  });
  it("shows no selected files after a full MediaStore permission revocation", () => {
    expect(liveSafePickerIds(new Set(["private"]), new Set()).size).toBe(0);
  });
});
