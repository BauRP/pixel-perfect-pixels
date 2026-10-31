/**
 * TanStack Start prerenders dist/client/index.html outside Vite's HTML pipeline.
 * @vitejs/plugin-legacy generates System.register chunks, but doesn't get to
 * inject its normal nomodule/polyfill bootstrap. For Android 7 WebView (Chrome
 * ~51), explicitly inject *offline* SystemJS + ES polyfills and the entry.
 * No runtime network request is needed; everything is copied into the APK.
 */
import { readFile, writeFile, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve("dist/client");
const indexPath = join(root, "index.html");
const assetsDir = join(root, "assets");
const html = await readFile(indexPath, "utf8");
const files = await readdir(assetsDir);
const candidates = files.filter(f => /^index-legacy-[\w-]+\.js$/.test(f));
if (candidates.length !== 1) {
  throw new Error("Expected one legacy entry chunk, found: " + candidates.join(", "));
}
const entry = candidates[0];
const copied = [
  ["systemjs/dist/s.min.js", "nova-system.min.js"],
  ["core-js-bundle/minified.js", "nova-core-polyfills.js"]
];
for (const [packageFile, destination] of copied) {
  const source = resolve("node_modules", packageFile);
  if (!(await stat(source).catch(() => null))?.isFile())
    throw new Error("Legacy runtime dependency not installed: " + source);
  await copyFile(source, join(assetsDir, destination));
}
await writeFile(join(assetsDir, "nova-bootstrap.js"),
  "(function(){'use strict';" +
  "if(!window.System||!window.System.import){throw Error('SystemJS unavailable');}" +
  "window.System.import('./assets/" + entry + "').catch(function(e){" +
  "console.error('[Nova legacy boot]',e);" +
  "if(typeof window.dispatchEvent==='function'){" +
  "var evt=document.createEvent('Event');evt.initEvent('nova-legacy-error',false,false);" +
  "window.dispatchEvent(evt);}" +
  "});" +
  "})();\n");
let output = html
  // Remove modern-only JavaScript that cannot even parse on Android 7.
  .replace(/<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*>(?:[\s\S]*?<\/script>)?/gi, "")
  .replace(/<link\b(?=[^>]*\brel\s*=\s*["']modulepreload["'])[^>]*>/gi, "")
  // The plugin's conditional HTML injection doesn't run in TanStack Start's
  // prerender step. Avoid any partial/double bootstrap from another plugin.
  .replace(/<script\b(?=[^>]*\bnomodule\b)[^>]*>[\s\S]*?<\/script>/gi, "");
if (!output.includes("</body>")) throw new Error("index.html missing </body>");
output = output.replace("</body>",
  '<script src="./assets/nova-core-polyfills.js"></script>' +
  '<script src="./assets/nova-system.min.js"></script>' +
  '<script src="./assets/nova-bootstrap.js"></script>' +
  '</body>');
await writeFile(indexPath, output);
console.log("[nova-legacy] Offline Android 7 loader installed:", entry);
