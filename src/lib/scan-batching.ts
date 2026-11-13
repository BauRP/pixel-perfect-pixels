/**
 * Transform a large MediaStore response without monopolizing the WebView's
 * JavaScript thread. Every batch gives input, React and the compositor a
 * chance to run. This does not skip, reorder or discard user media.
 */
export async function processInBatches<T>(
  items: readonly T[],
  process: (item: T) => void,
  batchSize = 256,
): Promise<void> {
  const size = Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : 256;
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && i % size === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    process(items[i]);
  }
}
