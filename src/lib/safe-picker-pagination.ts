/** Add items to the Safe picker in fixed pages, preserving all earlier tiles. */
export function nextSafePickerPage(total: number, visible: number, pageSize = 90): number {
  const max = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const current = Number.isFinite(visible) ? Math.max(0, Math.floor(visible)) : 0;
  const step = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 90;
  return Math.min(max, current + step);
}
