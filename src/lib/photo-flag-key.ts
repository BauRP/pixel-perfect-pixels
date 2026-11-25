/** MediaStore item IDs include size/mtime, which change when the original
 * file is edited. Protection and display-name overrides must follow the
 * same public MediaStore row across rescans, without changing gallery IDs. */
const NATIVE_MEDIA_VERSIONED_ID = /^(content:\/\/media\/external(?:_[A-Za-z0-9_-]+)?\/(?:file|(?:images|video)\/media)\/[1-9][0-9]*):[0-9]+:[0-9]+$/;

export function persistentPhotoFlagKey(id: string): string {
  const match = NATIVE_MEDIA_VERSIONED_ID.exec(id);
  return match ? `native:${match[1]}` : id;
}
