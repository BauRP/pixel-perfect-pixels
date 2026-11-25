import { describe, expect, it } from "vitest";
import { isPublishedMediaDestination } from "./public-restore-policy";

describe("Safe restored file publication receipts", () => {
  it("allows real public external MediaStore URIs and legacy public paths", () => {
    for (const path of [
      "content://media/external/images/media/44",
      "content://media/external_primary/video/media/20",
      "/storage/emulated/0/DCIM/photo.jpg",
      "/sdcard/Pictures/p.jpg",
      "/mnt/sdcard/Movies/v.mp4",
    ]) expect(isPublishedMediaDestination(path)).toBe(true);
  });
  it("does not permit removing encrypted originals for private or spoofed paths", () => {
    for (const path of [
      "content://media/internal/images/media/3",
      "content://media/external/images/media/0",
      "content://media/external/images/media/3?x=1",
      "/storage/emulated/0/Android/data/app/file",
      "/storage/emulated/0/Android/obb/secret",
      "/storage/emulated/0/../data/secret",
      "/storage/emulated/0/DCIM\\secret",
      "/data/data/private",
      "file:///storage/emulated/0/DCIM/a.jpg",
      "/storage/emulated/0/DCIM/",
      "",
    ]) expect(isPublishedMediaDestination(path)).toBe(false);
  });
});
