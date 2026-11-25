/** An Android media query can return rows but fail to decode every row.
 * Never interpret an entirely corrupt bridge response as an empty library.
 * A valid list of unsupported formats can still legitimately be empty. */
export function classifyNativeRows(
  totalRows: number, invalidRows: number, acceptedRows: number,
  nativeSkippedRows = 0,
): "success" | "empty" | "unavailable" {
  if (acceptedRows > 0) return "success";
  // Native Java may drop invalid Cursor rows before serializing the JS
  // array. Never mistake that truncated result for a truly empty library.
  if (nativeSkippedRows > 0) return "unavailable";
  if (totalRows > 0 && invalidRows === totalRows) return "unavailable";
  return "empty";
}
