import { describe, expect, it } from "vitest";
import { encodeSafeRestoreBlob } from "./safe-restore-encode";

describe("Safe restore encoding", () => {
  it("preserves every byte of a binary video", async () => {
    const raw = new Uint8Array([0, 1, 42, 127, 128, 200, 255]);
    expect(await encodeSafeRestoreBlob(new Blob([raw], { type: "video/mp4" })))
      .toBe(btoa(String.fromCharCode(...raw)));
  });
  it("encodes an empty file as empty base64", async () => {
    expect(await encodeSafeRestoreBlob(new Blob([], { type: "image/jpeg" }))).toBe("");
  });
});
