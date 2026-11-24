/** MediaStore.Files returns /file/{id}, while the album share policy
 * deliberately accepts only image and video collections. Convert only the
 * known public MediaStore row, without changing the gallery's persistent
 * item IDs, photo flags, cached thumbnails or Safe original paths. */
export type SharedKind = "image" | "video";

const FILE_URI = /^content:\/\/media\/(external(?:_[a-zA-Z0-9_-]+)?)\/file\/([1-9][0-9]*)$/;
const MEDIA_URI = /^content:\/\/media\/(external(?:_[a-zA-Z0-9_-]+)?)\/(images|video)\/media\/([1-9][0-9]*)$/;

export function mediaUriForSharing(uri: string, kind: SharedKind): string | null {
  const collection = kind === "image" ? "images" : "video";
  const file = FILE_URI.exec(uri);
  if (file) return `content://media/${file[1]}/${collection}/media/${file[2]}`;
  const specific = MEDIA_URI.exec(uri);
  return specific?.[2] === collection ? uri : null;
}

export function albumShareMime(
  items: readonly { kind: SharedKind }[],
): "image/*" | "video/*" | "*/*" {
  if (items.length === 0) return "*/*";
  if (items.every(item => item.kind === "image")) return "image/*";
  if (items.every(item => item.kind === "video")) return "video/*";
  return "*/*";
}
