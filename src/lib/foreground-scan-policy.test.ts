import { describe, expect, it } from "vitest";
import { mayStartDeferredScan } from "./foreground-scan-policy";

describe("native gallery foreground scan policy", () => {
  it("starts scanning only on the visible foreground page", () => {
    expect(mayStartDeferredScan("visible")).toBe(true);
    expect(mayStartDeferredScan("hidden")).toBe(false);
  });
});
