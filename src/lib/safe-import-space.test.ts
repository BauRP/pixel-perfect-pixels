import { describe, expect, it } from "vitest";
import { safeImportHasSpace } from "./safe-import-space";

describe("encrypted Safe disk capacity preflight", () => {
  it("allows known-good room for encrypted files and metadata", () => {
    expect(safeImportHasSpace(20 * 1024 * 1024, [8 * 1024 * 1024, 4 * 1024 * 1024])).toBe(true);
  });
  it("blocks imports when known free space cannot hold all encrypted copies", () => {
    expect(safeImportHasSpace(2 * 1024 * 1024, [2 * 1024 * 1024])).toBe(false);
    expect(safeImportHasSpace(0, [1])).toBe(false);
    expect(safeImportHasSpace(10 * 1024 * 1024, [9 * 1024 * 1024, 1000])).toBe(false);
  });
  it("keeps the existing rollback path when Android cannot report storage", () => {
    expect(safeImportHasSpace(null, [3 * 1024 * 1024])).toBe(true);
    expect(safeImportHasSpace(NaN, [123])).toBe(true);
  });
});
