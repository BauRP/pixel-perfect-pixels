import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBase64InBatches } from "./base64-batching";

afterEach(() => vi.useRealTimers());

describe("responsive native file base64 decoding", () => {
  it("preserves exact binary content across padded and unpadded chunk boundaries", async () => {
    const raw = new Uint8Array([0, 1, 2, 3, 4, 127, 128, 254, 255, 0, 9, 10, 123]);
    const encoded = btoa(String.fromCharCode(...raw));
    expect(Array.from(await decodeBase64InBatches(encoded, 8))).toEqual(Array.from(raw));
    expect(Array.from(await decodeBase64InBatches("AQIDBA", 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(await decodeBase64InBatches("AQ ID\nBA==", 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(await decodeBase64InBatches("", 4))).toEqual([]);
  });

  it("yields between decoding segments so the renderer can handle input", async () => {
    vi.useFakeTimers();
    const encoded = btoa(String.fromCharCode(...Array.from({ length: 192 }, (_, i) => i)));
    const ongoing = decodeBase64InBatches(encoded, 32);
    expect(vi.getTimerCount()).toBe(1);
    await vi.runAllTimersAsync();
    const decoded = await ongoing;
    expect(decoded).toHaveLength(192);
    expect(decoded[191]).toBe(191);
  });

  it("propagates corrupt native data instead of creating a wrong media file", async () => {
    await expect(decodeBase64InBatches("AQID$")).rejects.toThrow();
  });

  it("accepts the same complete encoded bytes regardless of chunk size", async () => {
    const raw = new Uint8Array(1024);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 73) & 255;
    const encoded = btoa(String.fromCharCode(...raw));
    expect(await decodeBase64InBatches(encoded, 64)).toEqual(
      await decodeBase64InBatches(encoded, 512),
    );
  });
});
