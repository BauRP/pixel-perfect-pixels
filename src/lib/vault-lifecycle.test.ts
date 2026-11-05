import { describe, expect, it } from "vitest";
import { isSafeOperationCurrent } from "./vault-lifecycle";

describe("Safe async operation generation", () => {
  it("rejects a pending unlock or decrypt after locking", () => {
    expect(isSafeOperationCurrent(3, 3)).toBe(true);
    expect(isSafeOperationCurrent(3, 4)).toBe(false);
  });
  it("rejects password work after another password update", () => {
    const original = { wrappedKey: "old" };
    const changed = { wrappedKey: "new" };
    expect(isSafeOperationCurrent(9, 9, original, original)).toBe(true);
    expect(isSafeOperationCurrent(9, 9, original, changed)).toBe(false);
    expect(isSafeOperationCurrent(9, 10, original, original)).toBe(false);
  });
});
