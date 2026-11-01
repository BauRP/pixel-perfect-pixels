/** Pure calculations shared by the UI and the Android 7–17 regression tests. */
export type RawSystemInsets = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  keyboardVisible?: boolean;
};
export type SafeSystemInsets = Required<RawSystemInsets>;
const normalizeNumber = (number: number | undefined): number => {
  const value = Number(number);
  if (!Number.isFinite(value)) return 0;
  return Math.ceil(Math.min(256, Math.max(0, value)));
};
export function normalizeSystemInsets(input: RawSystemInsets | null | undefined): SafeSystemInsets {
  return {
    top: normalizeNumber(input?.top),
    bottom: normalizeNumber(input?.bottom),
    left: normalizeNumber(input?.left),
    right: normalizeNumber(input?.right),
    keyboardVisible: input?.keyboardVisible === true,
  };
}

/** Actual UI height without system navigation (pin/gesture mode neutral).
 * While the IME is visible the bottom tab bar is hidden entirely. */
export function navReserveHeight(measuredHeight: number, imeVisible: boolean): number {
  if (imeVisible) return 0;
  if (!Number.isFinite(measuredHeight)) return 0;
  return Math.max(0, Math.ceil(measuredHeight));
}

// The bottom navigation height already includes Android's system navigation
// inset. Adding safe-bottom again would create a second empty strip.
export function scrollContentBottomReserve(navHeight: number, imeOpen: boolean): number {
  return navReserveHeight(navHeight, imeOpen);
}

// Bound inset values by the active WebView viewport to prevent impossible
// padding on very small split-screen windows. Never make negative CSS gaps.
export function fitInsetsToViewport(
  insets: SafeSystemInsets, viewportWidth: number, viewportHeight: number,
): SafeSystemInsets {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : null;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : null;
  const fitPair = (a: number, b: number, available: number | null): [number, number] => {
    // A zero-sized viewport is common before the first Android WebView frame.
    // It means 'not measured yet', NOT 'no status/navigation bars'.
    if (available === null) return [a, b];
    const sum = a + b;
    if (sum <= available) return [a, b];
    const share = a / sum;
    const fittedA = Math.floor(available * share);
    return [fittedA, Math.floor(available - fittedA)];
  };
  const [top, bottom] = fitPair(insets.top, insets.bottom, height);
  const [left, right] = fitPair(insets.left, insets.right, width);
  return { ...insets, top, bottom, left, right };
}
