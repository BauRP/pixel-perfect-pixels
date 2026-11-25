import { persistentPhotoFlagKey } from "./photo-flag-key";

/** Local display alias only; never replace a real filename passed to Safe,
 * Android MediaStore, sharing or editing. */
export function localDisplayName(
  item: { id: string; name: string },
  names: Readonly<Record<string, string>>,
): string {
  const alias = names[persistentPhotoFlagKey(item.id)];
  return typeof alias === "string" && alias.trim() ? alias : item.name;
}

/** Prevent empty/control-path-like labels in the local metadata store. */
export function validLocalDisplayName(input: string): string | null {
  const name = input.trim();
  if (!name || name.length > 120 || /[\\/\x00-\x1f\x7f]/.test(name)) return null;
  return name;
}
