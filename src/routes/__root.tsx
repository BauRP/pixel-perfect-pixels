import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Suspense, useEffect, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { nativeRouteUsesPersistentFrame } from "../lib/native-route-frame";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { initBackHandler } from "../lib/back-handler";
import { initSystemInsets } from "../lib/system-insets";
import { useT } from "../lib/i18n";

function NotFoundComponent() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("page_not_found")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("page_not_found_desc")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("go_home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error instanceof Error ? error : new Error(String(error)), { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("error_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("error_desc")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("try_again")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("go_home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover",
      },
      { name: "theme-color", content: "#000000" },
      { title: "Vault — Private Gallery" },
      { name: "description", content: "A mobile gallery with a PIN-protected encrypted Safe." },
      { property: "og:title", content: "Vault — Private Gallery" },
      { property: "og:description", content: "A premium mobile gallery with a PIN-protected encrypted Safe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // On Android the gallery must boot entirely offline. System-font
      // fallbacks are used without blocking on Google's remote font CSS.
    ],
  }),
  shellComponent: import.meta.env.VITE_CAPACITOR_BUILD === "1"
    ? NativeStandaloneShell : RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Injected as the FIRST script in <head>. Runs before any bundle so a crash
// during module evaluation (e.g. a native plugin failing to load inside the
// Android WebView) still paints a visible fallback instead of a white screen.
const BOOTSTRAP_ERROR_HANDLER = `
(function(){
  // Inline legacy-WebView polyfills. Runs BEFORE any bundled module is
  // evaluated, so Chrome 74 (Android 9) can parse code that relies on
  // String.prototype.replaceAll / .at, Array.prototype.at, Object.hasOwn.
  try {
    if (typeof String.prototype.replaceAll !== 'function') {
      Object.defineProperty(String.prototype, 'replaceAll', {
        configurable: true, writable: true,
        value: function(search, replacement){
          if (this == null) throw new TypeError('replaceAll called on null/undefined');
          var str = String(this);
          if (search instanceof RegExp){
            if (search.flags.indexOf('g') === -1) throw new TypeError('replaceAll needs a global RegExp');
            return str.replace(search, replacement);
          }
          var s = String(search);
          if (typeof replacement === 'function'){
            var out='', last=0, i=str.indexOf(s);
            if (s === ''){
              for (var k=0;k<=str.length;k++){ out += replacement('', k, str); if(k<str.length) out += str.charAt(k); }
              return out;
            }
            while (i !== -1){ out += str.slice(last, i) + String(replacement(s, i, str)); last = i + s.length; i = str.indexOf(s, last); }
            return out + str.slice(last);
          }
          var r = String(replacement);
          if (s === '') return r + str.split('').join(r) + r;
          return str.split(s).join(r);
        }
      });
    }
    if (typeof String.prototype.at !== 'function') {
      Object.defineProperty(String.prototype, 'at', { configurable:true, writable:true,
        value: function(n){ var s=String(this); n=Math.trunc(+n)||0; if(n<0) n+=s.length; return (n<0||n>=s.length)?undefined:s.charAt(n); } });
    }
    if (typeof Array.prototype.at !== 'function') {
      Object.defineProperty(Array.prototype, 'at', { configurable:true, writable:true,
        value: function(n){ var len=this.length>>>0; n=Math.trunc(+n)||0; if(n<0) n+=len; return (n<0||n>=len)?undefined:this[n]; } });
    }
    if (typeof Object.hasOwn !== 'function') {
      Object.defineProperty(Object, 'hasOwn', { configurable:true, writable:true,
        value: function(t,p){ if(t==null) throw new TypeError('hasOwn on null/undefined'); return Object.prototype.hasOwnProperty.call(Object(t), p); } });
    }
  } catch(_e) {}

  function paint(msg){
    try{
      var r=document.getElementById('root')||document.body;
      if(!r) return;
      if(r.getAttribute('data-nova-error')==='1') return;
      r.setAttribute('data-nova-error','1');
      r.innerHTML='<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0b0f;color:#f5f5f7;font:14px/1.5 -apple-system,system-ui,sans-serif"><div style="max-width:420px;text-align:center"><div style="font-size:18px;font-weight:600;margin-bottom:8px">Nova Gallery couldn\\'t start</div><div style="opacity:.75;margin-bottom:16px">'+String(msg||'Unexpected error').replace(/[<&]/g,'')+'</div><button onclick="location.reload()" style="background:#3b82f6;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600">Restart</button></div></div>';
    }catch(e){}
  }
  window.addEventListener('error',function(e){paint(e && (e.message||e.error && e.error.message));});
  window.addEventListener('unhandledrejection',function(e){paint(e && e.reason && (e.reason.message||e.reason));});
})();
`;

/**
 * TanStack Start owns <html>/<head>/<body> ONLY on the web SSR server.
 * Capacitor is built as a standalone index.html and mounted with createRoot()
 * into #root. Rendering another <html> inside #root is invalid DOM nesting
 * and prevents the route tree from mounting reliably on older WebViews.
 */
function NativeStandaloneShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <script data-nova-boot-error="1" dangerouslySetInnerHTML={{ __html: BOOTSTRAP_ERROR_HANDLER }} />
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        {import.meta.env.VITE_CAPACITOR_BUILD !== "1" && <Scripts />}
      </body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const nativeFrame = import.meta.env.VITE_CAPACITOR_BUILD === "1" &&
    nativeRouteUsesPersistentFrame(pathname);

  // The Android Vite entry uses createRoot(), not hydrateRoot(). Unlike
  // TanStack Start SSR on the website, the native shell has no server tree
  // to reconcile. Delaying <Outlet /> behind an artificial hydration gate
  // can leave older Chromium versions on an empty window indefinitely.
  // Single global hardware back-button listener (Android/Capacitor).
  useEffect(() => {
    initSystemInsets();
    initBackHandler();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {nativeFrame ? (
        // The frame and its OS-safe bottom tabs now survive a delayed child
        // route. React's root commit alone is not proof the child has loaded.
        <AppShell persistentRoot>
          <Suspense fallback={
            <div role="status" data-nova-route-pending
              style={{ padding: "36px 20px", color: "var(--color-foreground)" }}>
              Nova Gallery is loading…
            </div>
          }>
            <Outlet />
          </Suspense>
        </AppShell>
      ) : (
        // Website retains existing per-page frames and SSR semantics.
        // Privacy remains a separate full-screen document on Android.
        <Outlet />
      )}
    </QueryClientProvider>
  );
}
