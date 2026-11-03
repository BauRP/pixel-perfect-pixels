/**
 * Clamp configured folder-grid columns only when the *actual CSS viewport*
 * cannot contain legible cells. ADB display overrides physical pixels and
 * Android density separately; estimating columns from device model fails.
 * The preference is preserved and becomes active when the window expands.
 */
export function resolveAdaptiveGridColumns(
  preferredColumns: number, viewportWidth: number, minCellWidth = 96,
): number {
  const preferred = Number.isFinite(preferredColumns)
    ? Math.max(1, Math.min(12, Math.floor(preferredColumns))) : 2;
  // 0 is the first SSR render, before client viewport measurement.
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return preferred;
  // Use the gap belonging to the ACTUAL resulting number of columns,
  // otherwise a preferred 4-column grid clamped to 3 can underestimate
  // the spacing and still produce tiles thinner than minCellWidth.
  const horizontalPadding = 32;
  for (let count = preferred; count > 1; count--) {
    const gap = count >= 4 ? 8 : count === 3 ? 10 : 12;
    const required = horizontalPadding + count * minCellWidth + (count - 1) * gap;
    if (viewportWidth >= required) return count;
  }
  return 1;
}
