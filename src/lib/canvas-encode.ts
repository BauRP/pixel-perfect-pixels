/**
 * Encode an edited canvas without calling synchronous toDataURL on normal
 * Android WebViews. The encoded output and JPEG quality are unchanged.
 * Very old browsers without toBlob retain the working legacy fallback.
 */
export function encodeCanvasJpegBase64(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  const fromDataUrl = (value: string): string => {
    if (!/^data:image\/jpeg;base64,/i.test(value)) {
      throw new Error("JPEG encoder returned an invalid image");
    }
    return value.slice(value.indexOf(",") + 1);
  };

  if (typeof canvas.toBlob !== "function") {
    return Promise.resolve().then(() => fromDataUrl(canvas.toDataURL("image/jpeg", quality)));
  }

  return new Promise<string>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("JPEG encoder failed"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            if (typeof reader.result !== "string") {
              reject(new Error("JPEG file read failed"));
              return;
            }
            resolve(fromDataUrl(reader.result));
          } catch (error) { reject(error); }
        };
        reader.onerror = () => reject(new Error("JPEG file read failed"));
        reader.onabort = () => reject(new Error("JPEG file read aborted"));
        try { reader.readAsDataURL(blob); }
        catch (error) { reject(error); }
      }, "image/jpeg", quality);
    } catch (error) { reject(error); }
  });
}
