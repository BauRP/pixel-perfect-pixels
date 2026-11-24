import type { ScannedAlbum, ScannedItem } from "./device-scan";
import { processInBatches } from "./scan-batching";

type MediaEntry = { item: ScannedItem; path: string };
type AlbumMap = Map<string, ScannedItem[]>;

// Each full parent path is a separate folder. Two different "Camera"
// directories must not collapse into the same album.
function addMedia(groups: AlbumMap, { item, path }: MediaEntry): void {
  const slash = path.lastIndexOf("/");
  const key = (slash >= 0 ? path.slice(0, slash) : "") || "Root";
  let items = groups.get(key);
  if (!items) {
    items = [];
    groups.set(key, items);
  }
  items.push(item);
}

function createAlbum(name: string, items: ScannedItem[]): ScannedAlbum {
  // Preserve the exact existing ordering and item identity.
  items.sort((a, b) => b.mtime - a.mtime);
  return {
    id: encodeURIComponent(name),
    name: name.split("/").pop() || "Root",
    items,
  };
}

function sortedAlbums(albums: ScannedAlbum[]): ScannedAlbum[] {
  return albums.sort((a, b) => b.items.length - a.items.length);
}

/** Synchronous grouping for the existing browser/picker routes. */
export function groupMediaItems(entries: readonly MediaEntry[]): ScannedAlbum[] {
  const groups: AlbumMap = new Map();
  for (const entry of entries) addMedia(groups, entry);
  const result: ScannedAlbum[] = [];
  for (const [name, items] of groups) result.push(createAlbum(name, items));
  return sortedAlbums(result);
}


/** Yield while sorting a huge single folder; sorting only between folders
 * was not enough for a 100,000-photo camera roll. This stable merge retains
 * each original ScannedItem object and newest-first ordering. */
async function sortLargeAlbumItems(items: ScannedItem[]): Promise<void> {
  const batchSize = 8192;
  if (items.length <= batchSize) {
    items.sort((a, b) => b.mtime - a.mtime);
    return;
  }
  const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize).sort((a, b) => b.mtime - a.mtime);
    for (let j = 0; j < chunk.length; j++) items[i + j] = chunk[j];
    if (i + batchSize < items.length) await yieldToUi();
  }
  let source: ScannedItem[] = items;
  let target: ScannedItem[] = new Array<ScannedItem>(items.length);
  for (let width = batchSize; width < items.length; width *= 2) {
    let processed = 0;
    for (let start = 0; start < items.length; start += 2 * width) {
      let left = start;
      let right = Math.min(start + width, items.length);
      const leftEnd = right;
      const rightEnd = Math.min(start + 2 * width, items.length);
      for (let at = start; at < rightEnd; at++) {
        if (left === leftEnd) target[at] = source[right++];
        else if (right === rightEnd) target[at] = source[left++];
        else if (source[left].mtime >= source[right].mtime) target[at] = source[left++];
        else target[at] = source[right++];
        if (++processed % batchSize === 0) await yieldToUi();
      }
    }
    [source, target] = [target, source];
  }
  if (source !== items) {
    for (let i = 0; i < items.length; i += batchSize) {
      for (let j = i; j < Math.min(i + batchSize, items.length); j++)
        items[j] = source[j];
      if (i + batchSize < items.length) await yieldToUi();
    }
  }
}

/** Android MediaStore may return tens of thousands of items at once.
 * Group in bounded chunks and yield between folder sorts so React and
 * touch events can run; never drop or change any album or media item.
 */
export async function groupMediaItemsInBatches(
  entries: readonly MediaEntry[],
  batchSize = 256,
): Promise<ScannedAlbum[]> {
  const groups: AlbumMap = new Map();
  await processInBatches(entries, entry => addMedia(groups, entry), batchSize);
  const result: ScannedAlbum[] = [];
  // Sort the contents of every folder without monopolizing the WebView
  // when most of the library lives inside one giant Camera folder.
  for (const [name, items] of groups) {
    await sortLargeAlbumItems(items);
    result.push({
      id: encodeURIComponent(name),
      name: name.split("/").pop() || "Root",
      items,
    });
  }
  return sortedAlbums(result);
}
