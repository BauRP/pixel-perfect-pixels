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
if "hasLiveGallery()" not in html or "if (!node || hasLiveGallery()" not in html:
    raise SystemExit("Android startup handler must not cover a running gallery")
if "if (e && e.message)" not in html:
    raise SystemExit("Resource-loading errors must not be treated as fatal boot errors")
# This is not a TanStack Start hydrated document. Guard against accidentally
# reintroducing <html> inside the Vite createRoot('#root') Android entry.
native_route=Path("src/routes/__root.tsx").read_text("utf8")
if 'shellComponent: import.meta.env.VITE_CAPACITOR_BUILD === "1"' not in native_route:
    raise SystemExit("Android client must not render the web <html> shell inside #root")
if 'NativeStandaloneShell : RootShell' not in native_route:
    raise SystemExit("Web SSR and native SPA shells must remain separate")
if 'hydrated ? <Outlet /> : null' in native_route:
    raise SystemExit("Artificial Android hydration gate can block the real SPA")
router_source=Path("src/router.tsx").read_text("utf8")
if 'import.meta.env.VITE_CAPACITOR_BUILD === "1"' not in router_source:
    raise SystemExit("Android route history must be hash-based before Capacitor bridge is initialized")
if "defaultPendingComponent: NativeRoutePending" not in router_source:
    raise SystemExit("Native router must render a visible pending state for slow older WebViews")
root_source=Path("src/routes/__root.tsx").read_text("utf8")
app_shell_source=Path("src/components/AppShell.tsx").read_text("utf8")
if "<AppShell persistentRoot>" not in root_source or "nativeRouteUsesPersistentFrame" not in root_source:
    raise SystemExit("Android must mount a persistent bottom navigation outside asynchronous child routes")
if "data-nova-route-content" not in app_shell_source:
    raise SystemExit("Native route content must be distinguishable from the persistent shell")
if "ROUTE_CONTENT_NOT_MOUNTED" not in app_shell_source:
    raise SystemExit("A pending child route must never be reported as a ready gallery")
entry_source=Path("src/android-client.tsx").read_text("utf8")
if 'createRoot(mount).render(' not in entry_source:
    raise SystemExit("Standalone Android build must mount via createRoot")
if 'NativeStartupBoundary' not in entry_source:
    raise SystemExit("Android must have a React-level recovery boundary")
if 'flushSync(() =>' not in entry_source:
    raise SystemExit("Android first React commit must be synchronous on legacy WebViews")
if 'NativeRouterBootMonitor' not in entry_source:
    raise SystemExit("Android must provide an offline pending route fallback")
if 'void router.load().then' in entry_source:
    raise SystemExit("RouterProvider must exclusively own initial route load")
if 'nativeStartupState' not in entry_source or 'data-nova-boot-phase' not in entry_source or 'shouldShowBlockingBootOverlay' not in entry_source:
    raise SystemExit("Do not certify Android route before measured native layout is ready")
if 'react-root-committed' not in entry_source:
    raise SystemExit("Android must distinguish React commit from first paint")
shell_source=Path("src/components/AppShell.tsx").read_text("utf8")
if "paintFallbackTimer = setTimeout" not in shell_source:
    raise SystemExit("Native layout evidence must work when compositor requestAnimationFrame stalls")
print("OK: standalone Android SPA, native document shell, local polyfills, one module entry, no SSR.")
