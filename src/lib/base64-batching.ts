/**
 * Decode Capacitor Filesystem.readFile() base64 without materializing a
 * second, full-media binary string. This does NOT make the native bridge
 * streaming: Capacitor still returns one base64 string, and File still
 * needs the complete byte buffer. It does lower peak JS duplication and
 * yields to touch/paint between bounded chunks for large photos/videos.
 */
export async function decodeBase64InBatches(
  data: string,
  batchChars = 256 * 1024,
): Promise<Uint8Array> {
  // Browser atob() ignores HTML ASCII whitespace. Preserve that behavior
  // without allocating an additional copy for normal compact base64.
  const source = /[\t\n\f\r ]/.test(data)
    ? data.replace(/[\t\n\f\r ]/g, "")
    : data;
  const chars = Number.isFinite(batchChars)
    ? Math.max(4, Math.floor(batchChars / 4) * 4)
    : 256 * 1024;
  const padding = source.endsWith("==") ? 2 : source.endsWith("=") ? 1 : 0;
  const output = new Uint8Array(Math.max(0, Math.floor(source.length * 3 / 4) - padding));
  let offset = 0;
  for (let start = 0; start < source.length; start += chars) {
    // Every complete batch has a base64 quadruplet boundary. The final
    // batch may end with one/two padding marks or omit padding entirely.
    if (start > 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    const piece = atob(source.slice(start, start + chars));
    for (let i = 0; i < piece.length; i++) output[offset++] = piece.charCodeAt(i);
  }
  return output.subarray(0, offset);
}
