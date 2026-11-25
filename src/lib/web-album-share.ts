import type { ScannedItem } from "./device-scan";

type ShareHost = {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

export type WebAlbumShareResult = "shared" | "cancelled" | "unsupported";

// canShare can itself throw on restricted or old WebView browser contexts.
// An error here must not escape the share button or leave the gallery stuck.
function canShareFiles(host: ShareHost, files: File[]): boolean {
  if (!host.canShare) return true;
  try { return host.canShare({ files }); }
  catch { return false; }
}

/** Try all already-open browser Files at once; never decode an entire
 * native-sized album to ask whether the browser can share it. If the browser
 * cannot share a whole album, try just one accessible File. A cancelled share
 * must not unexpectedly launch another system chooser. */
export async function shareWebAlbum(
  items: readonly ScannedItem[],
  host: ShareHost,
  title: string,
  read: (item: ScannedItem) => Promise<File>,
  options: { requireAll?: boolean } = {},
): Promise<WebAlbumShareResult> {
  if (!host.share || items.length === 0) return "unsupported";
  const files = items.map(item => item.file);
  // For selected-file and full-album commands the user requested ALL files.
  // Do not fall back to sharing one random photo.
  if (options.requireAll) {
    if (!files.every((file): file is File => file !== null) ||
        !canShareFiles(host, files as File[])) return "unsupported";
    try {
      await host.share({ files: files as File[], title });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  if (host.canShare && files.every((file): file is File => file !== null)) {
    const allFiles = files as File[];
    if (canShareFiles(host, allFiles)) {
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
    if (!canShareFiles(host, [file])) continue;
    try {
      await host.share({ files: [file], title: file.name });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  return "unsupported";
}
