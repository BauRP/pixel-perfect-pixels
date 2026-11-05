import { describe, expect, it } from "vitest";
import { uuidV4FromBytes, createSecureId } from "./secure-id";

describe("cryptographic IDs on legacy Android WebView", () => {
  it("creates a standards-compliant v4 identifier without native randomUUID", () => {
    const value = uuidV4FromBytes(new Uint8Array(16).fill(255));
    expect(value).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("does not mutate the supplied random entropy", () => {
    const bytes = new Uint8Array(16).fill(1);
    uuidV4FromBytes(bytes);
    expect([...bytes]).toEqual(Array(16).fill(1));
    expect(() => uuidV4FromBytes(new Uint8Array(10))).toThrow();
  });
  it("uses browser crypto when available", () => {
    expect(createSecureId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
