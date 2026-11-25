import { describe, it, expect } from "vitest";
import { persistentPhotoFlagKey } from "./photo-flag-key";

describe("permanent media identity for protected photos", () => {
  it("keeps a media row stable across file size and modified time changes", () => {
    expect(persistentPhotoFlagKey("content://media/external/file/120:100:500"))
      .toBe(persistentPhotoFlagKey("content://media/external/file/120:101:900"));
    expect(persistentPhotoFlagKey("content://media/external_primary/images/media/99:100:500"))
      .toBe("native:content://media/external_primary/images/media/99");
  });
  it("does not change browser IDs, private URIs, or malformed MediaStore IDs", () => {
    for (const id of ["Pictures/family.jpg:100:500",
      "content://evil/file/123:20:40",
      "content://media/external/file/0:20:40",
      "content://media/external/file/6:abc:40"])
      expect(persistentPhotoFlagKey(id)).toBe(id);
  });
});
