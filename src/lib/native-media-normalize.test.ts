import { describe, it, expect } from "vitest";
import { normalizeNativeMedia } from "./native-media-normalize";

describe("Android MediaStore bridge metadata", () => {
  it("preserves a valid content URI and media details", () => {
    expect(normalizeNativeMedia({ uri: "content://media/external/images/media/4",
      name: "shot.jpg", mime: "image/jpeg", relativePath: "DCIM/Camera/",
      size: 231, mtime: 45 })).toEqual({
      uri: "content://media/external/images/media/4",
      name: "shot.jpg", mime: "image/jpeg", relativePath: "DCIM/Camera/",
      size: 231, mtime: 45,
    });
  });
  it("normalizes missing or invalid numeric fields rather than losing an album", () => {
    expect(normalizeNativeMedia({ uri: "content://media/5", name: "clip.mp4",
      size: -19, mtime: Number.NaN, mime: null, relativePath: undefined })).toEqual({
      uri: "content://media/5", name: "clip.mp4", size: 0, mtime: 0,
      mime: "", relativePath: "",
    });
  });
  it("rejects only malformed rows while retaining correctly formatted ones", () => {
    for (const row of [null, undefined, {}, "media", 7,
      {uri:"",name:"pic.jpg"}, {uri:"file:///bad",name:"pic.jpg"},
      {uri:"content://media/5"}, {uri:"content://media/6",name:""}])
      expect(normalizeNativeMedia(row)).toBeNull();
    expect(normalizeNativeMedia({uri:"content://media/7",name:"valid.jpg"})).not.toBeNull();
  });
});
