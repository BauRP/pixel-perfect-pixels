/** Viewport-aware media grid calculations shared by gallery route and tests.
 * AppShell's [data-app-content] is the scroll container; window.scrollY
 * remains zero while a long Android album moves underneath its fixed tabs.
 */
export function galleryGridScrollTarget(grid: HTMLElement): HTMLElement | Window {
  return grid.closest<HTMLElement>("[data-app-content]") ?? window;
}

export function galleryGridViewport(target: HTMLElement | Window): { top: number; bottom: number } {
  if (target === window) return { top: 0, bottom: window.innerHeight };
  const bounds = (target as HTMLElement).getBoundingClientRect();
  return { top: bounds.top, bottom: bounds.bottom };
}

/** Keep the visible row range inside the current item count, including when
 * a filter shrinks an album while the scroll position is near its end.
 */
export function galleryGridRange(
  itemCount: number, columns: number, rowHeight: number,
  gridTop: number, viewportTop: number, viewportBottom: number,
  overscanRows = 6,
): [number, number] {
  const count = Math.max(0, Math.floor(itemCount));
  if (count === 0) return [0, 0];
  const cols = Math.max(1, Math.floor(columns));
  const height = Math.max(1, rowHeight);
  const totalRows = Math.ceil(count / cols);
  const overscan = Math.max(0, Math.floor(overscanRows));
  const startRow = Math.min(totalRows - 1,
    Math.max(0, Math.floor((viewportTop - gridTop) / height) - overscan));
  const endRow = Math.min(totalRows,
    Math.max(startRow + 1, Math.ceil((viewportBottom - gridTop) / height) + overscan));
  return [startRow * cols, Math.min(count, endRow * cols)];
}
