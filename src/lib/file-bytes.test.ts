import { describe, expect, it, vi } from "vitest";
import { readFileBytes } from "./file-bytes";

describe("reading media for encrypted Safe import", () => {
  it("uses the native arrayBuffer method when available", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const read = vi.fn(async () => bytes);
    const file = { arrayBuffer: read } as unknown as Blob;
    await expect(readFileBytes(file)).resolves.toBe(bytes);
    expect(read).toHaveBeenCalledOnce();
  });

  it("reads actual Blob bytes through FileReader when legacy Android WebView lacks arrayBuffer", async () => {
    const original = FileReader;
    const bytes = new Uint8Array([5, 6, 7]);
    // Simulate the missing WebView API without changing the global Blob prototype.
    const file = { arrayBuffer: undefined } as unknown as Blob;
    const read = vi.fn();
    class LegacyReader {
      result: ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        read(blob);
        this.result = bytes.slice().buffer;
        this.onload?.();
      }
    }
    vi.stubGlobal("FileReader", LegacyReader);
    try {
      const result = await readFileBytes(file);
      expect([...new Uint8Array(result)]).toEqual([5, 6, 7]);
      expect(read).toHaveBeenCalledWith(file);
    } finally {
      vi.stubGlobal("FileReader", original);
      vi.unstubAllGlobals();
    }
  });

  it("rejects failed and cancelled legacy reads without fabricating success", async () => {
    const original = FileReader;
    const file = { arrayBuffer: undefined } as unknown as Blob;
    for (const mode of ["error", "abort", "bad-result"] as const) {
      class LegacyReader {
        result: string | null = mode === "bad-result" ? "invalid" : null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;
        readAsArrayBuffer() {
          if (mode === "error") this.onerror?.();
          else if (mode === "abort") this.onabort?.();
          else this.onload?.();
        }
      }
      vi.stubGlobal("FileReader", LegacyReader);
      await expect(readFileBytes(file)).rejects.toThrow();
    }
    vi.stubGlobal("FileReader", original);
    vi.unstubAllGlobals();
  });
});
