import { describe, expect, it } from "vitest";
import { measureAlbumForSort } from "./album-sort-metrics";

describe("large Android gallery album sort metrics", () => {
  it("returns well-defined sort keys for empty or partially invalid metadata", () => {
    expect(measureAlbumForSort([])).toEqual({ createdAt: 0, mtime: 0, size: 0 });
    expect(measureAlbumForSort([{ mtime: NaN, size: NaN },
      { mtime: -10, size: 5 }, { mtime: 20, size: 7 },
      { mtime: Infinity, size: -50 }])).toEqual({
      createdAt: -10, mtime: 20, size: 12,
    });
  });

  it("does not exceed function argument limits for 200000 photos", () => {
    const items = Array.from({ length: 200_000 }, (_, i) =>
      ({ mtime: i + 1, size: 1024 }));
    expect(measureAlbumForSort(items)).toEqual({
      createdAt: 1, mtime: 200_000, size: 204_800_000,
    });
  });
});
