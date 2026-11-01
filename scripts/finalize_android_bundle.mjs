/**
 * Vite's isolated Android build emits android-index.html. Capacitor expects
 * index.html; move the generated page and prepend locally bundled polyfills.
 * No TanStack hydration, server script, CDN, or runtime network dependency.
 */
import { copyFile, readFile, writeFile, rename, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const dir=resolve("dist/client");
const src=join(dir,"android-index.html");
const dst=join(dir,"index.html");
const core=resolve("node_modules/core-js-bundle/minified.js");
if (!(await stat(core).catch(()=>null))?.isFile()) throw Error("Missing offline core-js-bundle");
const content=await readFile(src,"utf8");
if (!content.includes('id="root"')) throw Error("Android client root missing");
if (!/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'][^"']+\.js["']/i.test(content) &&
    !/<script\b[^>]*\bsrc=["'][^"']+\.js["'][^>]*\btype=["']module["']/i.test(content))
  throw Error("Android native JS entry was not emitted");
const poly="./assets/nova-core-polyfills.js";
await copyFile(core,join(dir,"assets/nova-core-polyfills.js"));
const updated=content.replace(/<script\b(?=[^>]*\btype=["']module["'])[^>]*>\s*<\/script>/i,
  '<script src="'+poly+'"></script>\n$&');
if (updated===content) throw Error("Could not inject offline polyfill before module entry");
if (updated.includes("System.import")) throw Error("Old SystemJS bootstrap leaked into Android");
await writeFile(dst,updated);
console.log("[android SPA] Bundled own HTML, native module and offline polyfills.");
