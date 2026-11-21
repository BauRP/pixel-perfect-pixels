import type { ScannedItem } from "./device-scan";

type ShareHost = {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

export type WebAlbumShareResult = "shared" | "cancelled" | "unsupported";

/** Try all already-open browser Files at once; never decode an entire
 * native-sized album to ask whether the browser can share it. If the browser
 * cannot share a whole album, try just one accessible File. A cancelled share
 * must not unexpectedly launch another system chooser. */
export async function shareWebAlbum(
  items: readonly ScannedItem[],
  host: ShareHost,
  title: string,
  read: (item: ScannedItem) => Promise<File>,
): Promise<WebAlbumShareResult> {
  if (!host.share || items.length === 0) return "unsupported";
  const files = items.map(item => item.file);
  if (host.canShare && files.every((file): file is File => file !== null)) {
    const allFiles = files as File[];
    if (host.canShare({ files: allFiles })) {
      try {
        await host.share({ files: allFiles, title });
        return "shared";
      } catch {
        return "cancelled";
      }
    }
  }
  // A Share level-2 browser may reject multi-file shares while still
  // accepting a single file. Read no more than one file at a time.
  for (const item of items) {
    let file: File;
    try {
      file = item.file ?? await read(item);
    } catch {
      continue;
    }
    if (host.canShare && !host.canShare({ files: [file] })) continue;
    try {
      await host.share({ files: [file], title: file.name });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  return "unsupported";
}
