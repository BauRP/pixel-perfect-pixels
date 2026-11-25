import { describe, expect, it } from "vitest";
import { partitionDeletableMedia } from "./media-delete-protection";

describe("protected public media deletion policy", () => {
  const rows = [
    { id: "photo-protected", path: "content://media/external/images/media/1" },
    { id: "normal", path: "content://media/external/images/media/2" },
    { id: "another-protected", path: "content://media/external/images/media/3" },
  ];
  const protectedIds = new Set(["photo-protected", "another-protected"]);
  const partition = () => partitionDeletableMedia(rows, id => protectedIds.has(id));

  it("sends only unprotected media for deletion without changing input", () => {
    const { allowed, protectedItems } = partition();
    expect(allowed.map(item => item.id)).toEqual(["normal"]);
    expect(protectedItems.map(item => item.id)).toEqual(["photo-protected", "another-protected"]);
    expect(rows).toHaveLength(3);
  });
  it("prevents transferring protected originals into Safe while allowing unprotected selection", () => {
    const result = partitionDeletableMedia(rows, id => protectedIds.has(id));
    expect(result.allowed.map(x => x.id)).toEqual(["normal"]);
    expect(result.protectedItems.map(x => x.id)).toEqual(["photo-protected", "another-protected"]);
    // The original selection remains available to the gallery.
    expect(rows.map(x => x.id)).toEqual(["photo-protected", "normal", "another-protected"]);
  });

  it("prevents deleting an album when every selected photo is protected", () => {
    const result = partitionDeletableMedia(rows.slice(0, 1), id => protectedIds.has(id));
    expect(result.allowed).toEqual([]);
    expect(result.protectedItems).toHaveLength(1);
  });
  it("preserves ordinary deletion when nothing is protected", () => {
    const result = partitionDeletableMedia(rows, () => false);
    expect(result.allowed).toEqual(rows);
    expect(result.protectedItems).toEqual([]);
  });
});
