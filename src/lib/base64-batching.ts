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

/**
 * Encode large encrypted media without a single long btoa() call or a
 * second full-size binary-string allocation. Every complete chunk is a
 * multiple of 3 bytes, so concatenation preserves the exact Base64 format
 * already stored in existing Safe vaults.
 */
export async function encodeBase64InBatches(
  bytes: ArrayBuffer | Uint8Array,
  batchBytes = 192 * 1024,
): Promise<string> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const size = Number.isFinite(batchBytes)
    ? Math.max(3, Math.floor(batchBytes / 3) * 3)
    : 192 * 1024;
  const parts: string[] = [];
  for (let start = 0; start < input.length; start += size) {
    if (start > 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    const end = Math.min(input.length, start + size);
    let binary = "";
    // Spread at most 8192 values: older WebViews have small argument limits.
    for (let i = start; i < end; i += 8192) {
      binary += String.fromCharCode(...input.subarray(i, Math.min(i + 8192, end)));
    }
    parts.push(btoa(binary));
  }
  return parts.join("");
}
