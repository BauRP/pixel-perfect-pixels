/** Convert a decrypted Safe Blob to the existing native base64 protocol
 * without allocating an extra full-size Uint8Array and binary string.
 * This does NOT change the AES storage format or log any private bytes.
 */
export function encodeSafeRestoreBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !/^data:[^,]*;base64,/i.test(result)) {
        reject(new Error("Safe restore encoding failed"));
      } else {
        resolve(result.slice(result.indexOf(",") + 1));
      }
    };
    reader.onerror = () => reject(new Error("Safe restore encoding failed"));
    reader.onabort = () => reject(new Error("Safe restore encoding cancelled"));
    try { reader.readAsDataURL(blob); } catch (error) { reject(error); }
  });
}
