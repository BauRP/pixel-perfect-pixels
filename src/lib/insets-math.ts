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
