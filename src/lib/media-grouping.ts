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
  await processInBatches(Array.from(groups.entries()), ([name, items]) => {
    result.push(createAlbum(name, items));
  }, 32);
  return sortedAlbums(result);
}
