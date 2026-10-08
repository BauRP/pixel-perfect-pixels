// Mock general-gallery data. Thumbnails are CSS gradients (no external images).
export type MockItem = {
  id: string;
  name: string;
  kind: "image" | "video";
  gradient: string; // css background
  size: string;
  date: string;
};
export type MockFolder = {
  id: string;
  name: string;
  items: MockItem[];
};

const g = (a: string, b: string, c: string) =>
  `linear-gradient(135deg, ${a} 0%, ${b} 55%, ${c} 100%)`;

function makeItems(seed: number, count: number, palette: [string, string, string][]): MockItem[] {
  return Array.from({ length: count }).map((_, i) => {
    const p = palette[(seed + i) % palette.length];
    return {
      id: `${seed}-${i}`,
      name: `IMG_${(seed * 100 + i).toString().padStart(4, "0")}.${i % 6 === 5 ? "mp4" : "jpg"}`,
      kind: i % 6 === 5 ? "video" : "image",
      gradient: g(p[0], p[1], p[2]),
      size: `${(1.2 + ((seed * i) % 40) / 10).toFixed(1)} MB`,
      date: `Nov ${((seed * (i + 1)) % 28) + 1}, 2026`,
    };
  });
}

const P1: [string, string, string][] = [
  ["#0f2027", "#203a43", "#2c5364"],
  ["#ff6a00", "#ee0979", "#8e2de2"],
  ["#134e5e", "#71b280", "#f6d365"],
  ["#f857a6", "#ff5858", "#f6d365"],
];
const P2: [string, string, string][] = [
  ["#232526", "#414345", "#0f9b0f"],
  ["#00c6ff", "#0072ff", "#7f00ff"],
  ["#f7971e", "#ffd200", "#ff512f"],
  ["#43cea2", "#185a9d", "#000428"],
];
const P3: [string, string, string][] = [
  ["#3a1c71", "#d76d77", "#ffaf7b"],
  ["#1f4037", "#99f2c8", "#0575e6"],
  ["#c31432", "#240b36", "#000000"],
  ["#dd1818", "#333333", "#4b6cb7"],
];

export const MOCK_FOLDERS: MockFolder[] = [
  { id: "camera", name: "Camera", items: makeItems(1, 42, P1) },
  { id: "screenshots", name: "Screenshots", items: makeItems(2, 18, P2) },
  { id: "downloads", name: "Downloads", items: makeItems(3, 27, P3) },
  { id: "whatsapp", name: "WhatsApp Images", items: makeItems(4, 64, P1) },
  { id: "telegram", name: "Telegram", items: makeItems(5, 12, P2) },
  { id: "instagram", name: "Instagram", items: makeItems(6, 33, P3) },
];

export const getFolder = (id: string) => MOCK_FOLDERS.find((f) => f.id === id);
