/** An Android media query can return rows but fail to decode every row.
 * Never interpret an entirely corrupt bridge response as an empty library.
 * A valid list of unsupported formats can still legitimately be empty. */
export function classifyNativeRows(
  totalRows: number, invalidRows: number, acceptedRows: number,
): "success" | "empty" | "unavailable" {
  if (acceptedRows > 0) return "success";
  if (totalRows > 0 && invalidRows === totalRows) return "unavailable";
  return "empty";
}
