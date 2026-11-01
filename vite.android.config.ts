import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "node:path";

/**
 * Android is a browser-only React app: DO NOT run TanStack Start SSR,
 * streaming hydration or server-entry transformations in the WebView.
 * Share exact TanStack routeTree and components with the website instead.
 * Chrome 69 is the minimum WebView verified on our Android 7 emulator.
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tsconfigPaths(), tailwindcss()],
  define: {
    "import.meta.env.VITE_CAPACITOR_BUILD": JSON.stringify("1"),
  },
  build: {
    outDir: resolve("dist/client"),
    emptyOutDir: true,
    target: "chrome69",
    cssTarget: "chrome69",
    rollupOptions: { input: resolve("android-index.html") },
  },
  resolve: {
    alias: { "@": resolve("src") },
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
