import { describe, expect, it } from "vitest";
import { albumShareMime, mediaUriForSharing } from "./media-share-uri";

describe("native Android album sharing", () => {
  it("converts MediaStore.Files IDs to public image/video content URI", () => {
    expect(mediaUriForSharing("content://media/external/file/123", "image"))
      .toBe("content://media/external/images/media/123");
    expect(mediaUriForSharing("content://media/external/file/234", "video"))
      .toBe("content://media/external/video/media/234");
    expect(mediaUriForSharing("content://media/external_primary/file/345", "image"))
      .toBe("content://media/external_primary/images/media/345");
  });
  it("keeps existing valid photo/video URIs unchanged", () => {
    expect(mediaUriForSharing("content://media/external/images/media/41", "image"))
      .toBe("content://media/external/images/media/41");
    expect(mediaUriForSharing("content://media/external/video/media/42", "video"))
      .toBe("content://media/external/video/media/42");
  });
  it("rejects private, mismatched, malformed or query-modified URIs", () => {
    for (const uri of [
      "content://private.app/files/5", "content://media/internal/file/11",
      "content://media/external/file/0", "content://media/external/file/1?x=1",
      "content://media/external/file/../3", "file:///storage/emulated/0/Camera.jpg",
      "content://media/external/video/media/45",
    ]) expect(mediaUriForSharing(uri, "image")).toBeNull();
    expect(mediaUriForSharing("content://media/external/images/media/45", "video"))
      .toBeNull();
  });
  it("selects chooser MIME from the entire album, never only the first file", () => {
    const image = { kind: "image" as const };
    const video = { kind: "video" as const };
    expect(albumShareMime([])).toBe("*/*");
    expect(albumShareMime([image, image])).toBe("image/*");
    expect(albumShareMime([video, video])).toBe("video/*");
    expect(albumShareMime([image, video, image])).toBe("*/*");
  });
});
