// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//    - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro, componentTagger (dev-only),
//      VITE_* env injection, @ path alias, React/TanStack dedupe, error logger plugins, sandbox detection.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const isCapacitorBuild = process.env.CAPACITOR_BUILD === "1";

/**
 * Rewrite absolute `/assets/...` URLs emitted by Vite / TanStack Start's SPA
 * prerender into relative `./assets/...` URLs so the bundle loads under
 * `androidScheme: 'file'` in the Android WebView (file:// has no origin, so
 * a leading `/` resolves to the device filesystem root and 404s).
 */
function capacitorRelativeAssetsPlugin(): Plugin {
  // ИЗМЕНЕНО: теперь указываем 'dist/client', чтобы не ломать серверные файлы пререндера
  const outDir = "dist/client"; 
  const exts = new Set([".html", ".js", ".mjs", ".cjs", ".css", ".map"]);
  const patterns: Array<[RegExp, string]> = [
    // Fix `/./assets/...` (TanStack Start emits these when base is `./`) BEFORE
    // the generic `/assets/` rules so we don't double-rewrite. Under
    // `androidScheme: 'file'` any leading `/` resolves to the device filesystem
    // root and 404s.
    [/(["'`\(=])\/\.\/assets\//g, "$1./assets/"],
    [/url\(\/\.\/assets\//g, "url(./assets/"],
    [/(?<![A-Za-z0-9_])\/\.\/assets\//g, "./assets/"],
    [/(["'`\(=])\/assets\//g, "$1./assets/"],
    [/url\(\/assets\//g, "url(./assets/"],
    [/(?<![A-Za-z0-9_])\/assets\//g, "./assets/"],
  ];

  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(full)));
      else if (exts.has(path.extname(e.name))) out.push(full);
    }
    return out;
  }

  return {
    name: "capacitor-relative-assets",
    apply: "build",
    async closeBundle() {
      const root = path.resolve(process.cwd(), outDir);
      try {
        await fs.access(root);
      } catch {
        return;
      }
      const files = await walk(root);
      let patched = 0;
      for (const file of files) {
        let src = await fs.readFile(file, "utf8");
        const before = src;
        for (const [re, rep] of patterns) src = src.replace(re, rep);
        if (file.endsWith(".html")) {
          src = src.replace(/<base\s+href=["']\/["']\s*\/?>/gi, "");
          // CRITICAL for Android 8/9: strip the SSR-prerendered contents of
          // <div id="root">…</div> so the WebView boots into a truly empty
          // container. TanStack Start's prerender emits React Suspense
          // hydration markers (<!--$-->…<!--/$-->) plus a scroll-restoration
          // <script>; hydrating those against a client tree that renders
          // `null` on the first pass (see src/routes/__root.tsx hydrated
          // gate) still produced a Suspense-shape mismatch in older Chromium
          // WebViews, surfacing as "Minified React error #418". With an
          // empty <div id="root"></div>, hydrateRoot has nothing to
          // reconcile against and the app mounts as a pure SPA.
          src = src.replace(
            /<div id="root">[\s\S]*?<\/div>(?=\s*<script)/,
            '<div id="root"></div>',
          );
          // Also drop the TanStack streaming barrier <script> — it drives
          // hydration matching we no longer need in strict SPA mode, and
          // leaving it in has caused parse issues on some devices.
          src = src.replace(
            /<script class="\$tsr"[\s\S]*?<\/script>/,
            "",
          );
        }
        if (src !== before) {
          await fs.writeFile(file, src);
          patched++;
        }
      }
      console.log(`[capacitor-relative-assets] rewrote ${patched} file(s) in ${outDir}`);
    },
  };
}

export default defineConfig({
  vite: {
    base: isCapacitorBuild ? "./" : "/",
    define: {
      // Exposed to both prerender (Node build) AND client bundle so the two
      // environments agree on whether this is a Capacitor build. Used by
      // src/routes/__root.tsx to skip SSR content and render the app purely
      // on the client, avoiding React #418 hydration mismatches inside the
      // Android WebView (localStorage-backed i18n, Capacitor.isNativePlatform
      // checks, etc. all diverge between build-time and runtime).
      "import.meta.env.VITE_CAPACITOR_BUILD": JSON.stringify(
        isCapacitorBuild ? "1" : "",
      ),
    },
    // Android WebView on older devices (Android 7-9, Chromium <74) does not
    // support ES2022 public class fields (`class X { field = 1 }`) — which
    // Vite/esbuild would otherwise emit and which produces the runtime
    // `Uncaught SyntaxError: Unexpected token '='` crash right after the
    // startup ad. Force esbuild to down-level class fields and other newer
    // syntax to a baseline that every supported WebView can parse.
    ...(isCapacitorBuild
      ? {
          build: {
            target: ["es2019", "chrome74"],
            cssTarget: ["chrome74"],
          },
          esbuild: {
            target: "es2019",
            supported: {
              "class-field": false,
              "class-static-field": false,
            },
          },
        }
      : {}),
  },
  tanstackStart: isCapacitorBuild
    ? {
        spa: {
          enabled: true,
          maskPath: "/",
          prerender: {
            enabled: true,
            outputPath: "index.html",
            crawlLinks: false,
            retryCount: 0,
          },
        },
      }
    : {
        server: { entry: "server" },
      },
  ...(isCapacitorBuild
    ? { nitro: false as const, plugins: [capacitorRelativeAssetsPlugin()] }
    : {}),
});
