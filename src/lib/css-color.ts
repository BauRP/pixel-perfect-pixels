// ── Theme colour resolution (any CSS colour → #rrggbb) ─────────────────────
let ctx: CanvasRenderingContext2D | null = null;
export function cssColorToHex(cssColor: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = fallback;
  ctx.fillStyle = cssColor || fallback;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}
