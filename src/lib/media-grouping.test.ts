import { afterEach, describe, expect, it, vi } from "vitest";
import { groupMediaItems, groupMediaItemsInBatches } from "./media-grouping";
import type { ScannedItem } from "./device-scan";

afterEach(() => vi.useRealTimers());

function media(path: string, mtime: number) {
  const item: ScannedItem = {
    id: path, path, name: path.split("/").pop() || "",
    mtime, size: 42, kind: "image", file: null, url: path,
  };
  return { item, path };
}

describe("native MediaStore responsive album grouping", () => {
  it("groups identical folder names separately and preserves newest-first sorting", async () => {
    const input = [
      media("DCIM/Camera/b.jpg", 20),
      media("Pictures/Camera/x.jpg", 12),
      media("DCIM/Camera/a.jpg", 30),
      media("DCIM/Camera/c.jpg", 10),
      media("lonely.jpg", 1),
    ];
    const expected = groupMediaItems(input);
    const actual = await groupMediaItemsInBatches(input, 2);
    expect(actual).toEqual(expected);
    expect(actual.map(x => x.id)).toEqual(["DCIM%2FCamera", "Pictures%2FCamera", "Root"]);
    expect(actual[0].items.map(x => x.id)).toEqual([
      "DCIM/Camera/a.jpg", "DCIM/Camera/b.jpg", "DCIM/Camera/c.jpg",
    ]);
    expect(actual[0].items[0]).toBe(input[2].item);
  });

  it("yields during a large grouping instead of blocking the WebView for the entire list", async () => {
    vi.useFakeTimers();
    const originals = Array.from({ length: 600 }, (_, index) =>
      media("DCIM/Camera/file" + index + ".jpg", index));
    const job = groupMediaItemsInBatches(originals, 100);
    let settled = false;
    void job.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    const albums = await job;
    expect(albums).toHaveLength(1);
    expect(albums[0].items).toHaveLength(600);
    expect(albums[0].items[0].mtime).toBe(599);
  });

  it("handles an empty response and nested camera folders without changing user media", async () => {
    expect(await groupMediaItemsInBatches([])).toEqual([]);
    const entries = [media("DCIM/Camera/one.jpg", 1), media("Download/Camera/two.jpg", 2)];
    const actual = await groupMediaItemsInBatches(entries);
    expect(actual.map(x => x.name)).toEqual(["Camera", "Camera"]);
    expect(new Set(actual.map(x => x.id)).size).toBe(2);
  });
});
