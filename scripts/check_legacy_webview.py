#!/usr/bin/env python3
"""Check isolated Android SPA output, not TanStack Start SSR output."""
from html.parser import HTMLParser
from pathlib import Path

root=Path("dist/client")
html=(root/"index.html").read_text("utf8")
class Parse(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts=[]
    def handle_starttag(self,tag,attrs):
        if tag=="script": self.scripts.append(dict(attrs))
p=Parse();p.feed(html)
js=p.scripts
inline=[a for a in js if not a.get("src")]
module=[a for a in js if a.get("type")=="module"]
if len(inline)!=1 or inline[0].get("data-nova-boot-error")!="1":
    raise SystemExit("Android SPA error handler or SSR script count incorrect: "+str(inline))
if len(module)!=1 or len(js)!=3:
    raise SystemExit("Expected exactly inline error, offline polyfill and native module: "+str(js))
if js[1].get("src")!="./assets/nova-core-polyfills.js":
    raise SystemExit("Offline JS polyfills must be loaded first")
if not (root/"assets/nova-core-polyfills.js").is_file():
    raise SystemExit("Missing local core-js payload")
entry=module[0].get("src","")
if not entry.startswith("./assets/") or not (root/entry).is_file():
    raise SystemExit("Missing Android bundled JS entry: "+entry)
if "System.import" in html or "$tsr" in html or "window.__TSR" in html:
    raise SystemExit("TanStack server hydrate stream leaked into Android APK")
if "https://fonts.googleapis.com" in html:
    raise SystemExit("Android runtime must not fetch external fonts")
# This is not a TanStack Start hydrated document. Guard against accidentally
# reintroducing <html> inside the Vite createRoot('#root') Android entry.
native_route=Path("src/routes/__root.tsx").read_text("utf8")
if 'shellComponent: import.meta.env.VITE_CAPACITOR_BUILD === "1"' not in native_route:
    raise SystemExit("Android client must not render the web <html> shell inside #root")
if 'NativeStandaloneShell : RootShell' not in native_route:
    raise SystemExit("Web SSR and native SPA shells must remain separate")
if 'hydrated ? <Outlet /> : null' in native_route:
    raise SystemExit("Artificial Android hydration gate can block the real SPA")
entry_source=Path("src/android-client.tsx").read_text("utf8")
if 'createRoot(mount).render(' not in entry_source:
    raise SystemExit("Standalone Android build must mount via createRoot")
print("OK: standalone Android SPA, native document shell, local polyfills, one module entry, no SSR.")
