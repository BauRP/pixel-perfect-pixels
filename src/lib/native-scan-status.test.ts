import { describe, it, expect } from "vitest";
import { classifyNativeRows } from "./native-scan-status";

describe("native MediaStore empty-library safety", () => {
  it("accepts a genuinely empty result", () => {
    expect(classifyNativeRows(0, 0, 0)).toBe("empty");
  });
  it("preserves previous albums if all native provider entries are corrupt", () => {
    expect(classifyNativeRows(2, 2, 0)).toBe("unavailable");
    expect(classifyNativeRows(1, 1, 0)).toBe("unavailable");
  });
  it("does not block valid photographs because one row is damaged", () => {
    expect(classifyNativeRows(3, 1, 2)).toBe("success");
  });
  it("retains legitimate empty results when only unsupported valid media is returned", () => {
    expect(classifyNativeRows(2, 0, 0)).toBe("empty");
    expect(classifyNativeRows(3, 1, 0)).toBe("empty");
  });
});
