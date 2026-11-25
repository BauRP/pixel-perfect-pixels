import { describe, expect, it } from "vitest";
import { safeStorageUsage } from "./safe-storage-capacity";

describe("Safe storage limits", () => {
  it("uses actual device free space instead of a fabricated fixed quota", () => {
    expect(safeStorageUsage(2 * 1024, 6 * 1024))
      .toEqual({ capacityBytes: 8 * 1024, percent: 25 });
    expect(safeStorageUsage(10, 0))
      .toEqual({ capacityBytes: 10, percent: 100 });
  });
  it("never displays a percentage when disk size cannot be confirmed", () => {
    expect(safeStorageUsage(100, null)).toBeNull();
    expect(safeStorageUsage(0, 0)).toBeNull();
    expect(safeStorageUsage(-1, 100)).toBeNull();
    expect(safeStorageUsage(100, NaN)).toBeNull();
    expect(safeStorageUsage(100, Infinity)).toBeNull();
  });
});
