/** Read original file bytes on both current WebViews and Android 7-era
 * WebViews, where Blob.arrayBuffer() may not exist. No plaintext is stored
 * outside the caller; the Safe session is rechecked after this await. */
export function readFileBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Could not read selected file"));
    };
    reader.onerror = () => reject(new Error("Could not read selected file"));
    reader.onabort = () => reject(new Error("File read was cancelled"));
    try {
      reader.readAsArrayBuffer(file);
    } catch {
      reject(new Error("Could not read selected file"));
    }
  });
}
