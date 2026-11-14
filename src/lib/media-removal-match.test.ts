import { describe, expect, it } from "vitest";
import { createRemovalMatcher } from "./media-removal-match";

describe("media removal on large gallery/Safe batches", () => {
  it("matches original content URIs exactly, not another image with the same name", () => {
    const match = createRemovalMatcher(["content://media/external/images/media/101"]);
    expect(match({ path: "DCIM/Camera/a.jpg", nativeUri: "content://media/external/images/media/101" })).toBe(true);
    expect(match({ path: "DCIM/Camera/a.jpg", nativeUri: "content://media/external/images/media/102" })).toBe(false);
    expect(match({ path: "DCIM/Camera/a.jpg", nativeUri: "content://media/external/images/media/1010" })).toBe(false);
  });

  it("retains legacy absolute-to-relative folder path and file URI behavior", () => {
    const match = createRemovalMatcher(["file:///storage/emulated/0/DCIM/Camera/a.jpg"]);
    expect(match({ path: "DCIM/Camera/a.jpg" })).toBe(true);
    expect(match({ path: "/storage/emulated/0/DCIM/Camera/a.jpg" })).toBe(true);
    expect(match({ path: "Pictures/Camera/a.jpg" })).toBe(false);
    expect(match({ path: "DCIM/Camera/a.jpg.bak" })).toBe(false);
    expect(match({ path: "DCIM/Camera/a.jp" })).toBe(false);
  });

  it("does not accidentally match paths that merely share a name prefix", () => {
    const match = createRemovalMatcher(["/storage/DCIM/Screenshots/photo.jpg"]);
    expect(match({ path: "DCIM/Screenshots/photo.jpg" })).toBe(true);
    expect(match({ path: "DCIM/Screenshots/photo.jpg2" })).toBe(false);
    expect(match({ path: "Other/Screenshots/photo.jpg" })).toBe(false);
    expect(match({ path: "DCIM/Screenshots/photo.jpg", nativeUri: "content://unrelated" })).toBe(true);
  });

  it("scales across a large delete batch without changing matched files", () => {
    const deleted = Array.from({ length: 3000 }, (_, i) =>
      `/storage/emulated/0/DCIM/Camera/photo-${i}.jpg`);
    const match = createRemovalMatcher(deleted);
    for (let i = 0; i < 3000; i++) {
      expect(match({ path: `DCIM/Camera/photo-${i}.jpg` })).toBe(true);
      expect(match({ path: `DCIM/Camera/photo-${i}.jpg.old` })).toBe(false);
    }
    expect(createRemovalMatcher([])({ path: "DCIM/Camera/photo-1.jpg" })).toBe(false);
  });
});
