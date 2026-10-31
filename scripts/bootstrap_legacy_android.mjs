/**
 * Offline native Android WebView entry installer.
 *
 * The Android 7 emulator has Chromium 69, which supports <script type=module>
 * and native dynamic import. The old forced SystemJS build caused syntax
 * failures on Android 7/10/13/16. This path uses a native module entry
 * compiled to chrome69 plus a *local* ES feature polyfill bundle.
 *
 * TanStack Start prerenders HTML outside Vite's index.html pipeline, so
 * its unrelated SSR/hydration scripts must NOT run as plain JavaScript.
 */
import { readFile, writeFile, copyFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const out = resolve("dist/client");
const assets = join(out, "assets");
const index = join(out, "index.html");
const [html, files] = await Promise.all([readFile(index, "utf8"), readdir(assets)]);

const moduleEntries = files.filter(name => /^index-[\w-]+\.js$/.test(name) && !name.includes("-legacy-"));
if (moduleEntries.length !== 1) {
  throw new Error("Android module entry should be unique: " + JSON.stringify({
    indexCandidates: moduleEntries,
    jsExamples: files.filter(name => name.endsWith(".js")).slice(0,25)
  }));
}
const entry = moduleEntries[0];
const source = resolve("node_modules/core-js-bundle/minified.js");
if (!(await stat(source).catch(() => null))?.isFile()) {
  throw new Error("core-js-bundle not installed: " + source);
}
await copyFile(source, join(assets, "nova-core-polyfills.js"));

// A pre-rendered <script> could contain raw ESM import syntax but lacks
// type="module" in the resulting TanStack page. Strip every such script and
// preserve only the purposely ES5-compatible crash handler.
let output = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, script =>
    /\bdata-nova-boot-error\s*=\s*["']1["']/i.test(script) ? script : "")
  .replace(/<script\b[^>]*\/\s*>/gi, "")
  .replace(/<link\b(?=[^>]*\brel\s*=\s*["']modulepreload["'])[^>]*>/gi, "");
if (!output.includes("</body>")) throw new Error("Missing closing body in Android HTML");
if (!/data-nova-boot-error=["']1["']/.test(output)) {
  throw new Error("Expected ES5-compatible inline startup error handler");
}
output = output.replace("</body>",
  '<script src="./assets/nova-core-polyfills.js"></script>' +
  '<script type="module" src="./assets/' + entry + '"></script>' +
  '</body>');
await writeFile(index, output);
console.log("[nova-android] Offline core-js and Chrome69 module entry:", entry);
