# Nova Gallery — ARCHITECTURE.md

Complete engineering DNA of the application, extracted from the current source tree.
Application ID: `app.lovable.privacygallery` · Display name: **Nova Gallery** · versionCode `1` / versionName `1.0.0`.

Nova Gallery is a **local-first, offline, privacy gallery** for Android. There is **no backend, no database, no API server and no cloud account**. Media never leaves the device. It ships as a TanStack Start (React 19) web bundle wrapped in a Capacitor 8 Android shell, plus a **custom native Java plugin (`SecureVault`)** and a **custom `MainActivity`**. Revenue comes from **Google AdMob** (native Android shell only; the web build never loads an ad SDK): a native ad as the first gallery tile. There is no banner. There are **no full-screen ads** (no App Open ad on launch or resume) and **no cooldown timers**. See §5.6 and §6.

---

## 1. CORE TECH STACK & ENVIRONMENT

### 1.1 Runtime / framework dependencies (exact ranges from `package.json`)

| Package | Version | Role |
|---|---|---|
| `react` / `react-dom` | `^19.2.0` | UI runtime |
| `@tanstack/react-router` | `^1.170.16` | File-based routing (`src/routes`) |
| `@tanstack/react-start` | `^1.168.26` | Full-stack framework / SSR + SPA prerender |
| `@tanstack/router-plugin` | `^1.168.18` | Generates `src/routeTree.gen.ts` |
| `@tanstack/react-query` | `^5.101.1` | Provider mounted in `__root.tsx`; **currently no queries are defined** — no remote data exists |
| `vite` | `^8.0.16` | Build tool |
| `@lovable.dev/vite-tanstack-config` | `2.9.0` | Pre-bundled Vite config (tanstackStart, viteReact, tailwindcss, tsconfigPaths, nitro, componentTagger, `@` alias, dedupe). **Never re-add these plugins manually.** |
| `nitro` | `3.0.260603-beta` | Server output (web build only; disabled for Capacitor) |
| `tailwindcss` + `@tailwindcss/vite` | `^4.2.1` | Tailwind **v4**, CSS-first config (no `tailwind.config.js`, no PostCSS file) |
| `tw-animate-css` | `^1.3.4` | Animation utility layer |
| `lucide-react` | `^0.575.0` | All icons |
| `sonner` | `^2.0.7` | Toasts (`toast.success` / `toast.error`) |
| `zod` | `^3.24.2` | Available; used for route-search validation patterns |
| `react-window` | `^2.2.7` | Installed; the gallery uses a **hand-written** virtualizer instead |
| `date-fns`, `recharts`, `embla-carousel-react`, `cmdk`, `vaul`, `input-otp`, `react-hook-form`, `@hookform/resolvers`, `react-day-picker`, `react-resizable-panels` | see package.json | shadcn/ui scaffolding deps, mostly unused by app screens |
| `@radix-ui/*` (26 packages) | see package.json | shadcn/ui primitives under `src/components/ui` |
| `class-variance-authority` `^0.7.1`, `clsx` `^2.1.1`, `tailwind-merge` `^3.5.0` | | `cn()` helper |

### 1.2 Capacitor / native dependencies

| Package | Version | Purpose |
|---|---|---|
| `@capacitor/core` / `cli` / `android` | `^8.4.1` | Native shell |
| `@capacitor/filesystem` | `^8.1.2` | **Device media scan** + encrypted-blob read/write |
| `@capacitor/preferences` | `^8.0.1` | Installed & synced into the Android project |
| `@capacitor/app` | `^8.1.1` | Hardware back button, `exitApp()` |
| `@capacitor/status-bar` | `^8.0.3` | Status-bar overlay/style control (lazily imported) |

Registered Android plugins (`android/app/src/main/assets/capacitor.plugins.json`): `AppPlugin`, `FilesystemPlugin`, `PreferencesPlugin`, `StatusBarPlugin`, plus the hand-written `SecureVault` and `NativeAds` plugins registered in `MainActivity`. No AdMob community plugin.

### 1.3 Dev tooling

`typescript ^5.8.3`, `eslint ^9.32.0` + `typescript-eslint ^8.56.1` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `eslint-config-prettier` + `eslint-plugin-prettier`, `prettier ^3.7.3`, `globals ^15.15.0`, `@types/node ^22.16.5`, `@types/react(^19.2.0)`, `@types/react-dom`, `@types/react-window`, `@vitejs/plugin-react ^5.2.0`. Package manager: **bun** (`bunfig.toml`, `bun.lock`).

### 1.4 npm scripts

```
dev              vite dev
build            vite build                      (web / SSR)
build:dev        vite build --mode development
preview          vite preview
lint             eslint .
format           prettier --write .
build:capacitor  CAPACITOR_BUILD=1 vite build && cap sync android
android:open     CAPACITOR_BUILD=1 vite build && cap sync android && cap open android
```

`CAPACITOR_BUILD=1` is the single switch that flips the whole build into "native SPA" mode.

### 1.5 `vite.config.ts` — two build personalities

`const isCapacitorBuild = process.env.CAPACITOR_BUILD === "1";`

**Web build (default):**
- `base: "/"`
- `tanstackStart: { server: { entry: "server" } }` → SSR via `src/server.ts`, Nitro enabled.

**Capacitor build:**
- `base: "./"` — required because `androidScheme: "file"` has no origin.
- `define["import.meta.env.VITE_CAPACITOR_BUILD"] = "1"` — visible to **both** the Node prerender and the client bundle.
- `build.target: ["es2019","chrome74"]`, `build.cssTarget: ["chrome74"]`.
- `esbuild.target: "es2019"` with `supported: { "class-field": false, "class-static-field": false }` — **fixes the `Uncaught SyntaxError: Unexpected token '='` crash on Android 7–9 (Chromium < 74)**.
- `tanstackStart.spa`: `{ enabled: true, maskPath: "/", prerender: { enabled: true, outputPath: "index.html", crawlLinks: false, retryCount: 0 } }`.
- `nitro: false`.
- Custom plugin `capacitorRelativeAssetsPlugin()` (see §5.1).

### 1.6 Capacitor config (`capacitor.config.ts`)

```ts
appId: "app.lovable.privacygallery"
appName: "Nova Gallery"
webDir: "dist/client"
android: { allowMixedContent: false }
server:  { androidScheme: "file" }
```

### 1.7 Tailwind v4 configuration (`src/styles.css`)

- `@import "tailwindcss" source(none);` + `@source "../src";` — explicit scan root; **no automatic content detection**.
- `@import "tw-animate-css";`
- `@custom-variant dark (&:is(.dark *));` — dark mode is **class-driven**, toggled on `<html>` by `useApplyTheme()`.
- `@theme inline { … }` maps design tokens: radii `--radius-sm|md|lg|xl|2xl|3xl|4xl` derived from `--radius: 1rem`; colors `background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, surface, surface-elevated, accent-glow`; fonts `--font-display: "Space Grotesk"`, `--font-sans: "Inter"`.
- All colors are **OKLCH**. Default `:root` is a **pure-black OLED dark theme** (`--background: oklch(0 0 0)`, accent = green `oklch(0.72 0.18 155)`). `.light` overrides the whole palette.
- Base layer: `html, body { min-height: 100vh; min-height: 100dvh; overscroll-behavior-y: none; }` and `#root { min-height: 100dvh }` — the `dvh` duplication is the anti-letterbox fix for tall screens.
- Custom `@utility` classes: `glass` (60% surface + `blur(24px) saturate(160%)`), `glass-strong` (82% + `blur(32px) saturate(180%)`), `tap` (44×44 minimum hit area).
- Keyframes `fade-up`, `scale-in`, `pulse-ring` with `.animate-fade-up`, `.animate-scale-in`, `.animate-pulse-ring`; `.no-scrollbar`.

### 1.8 Viewport / head metadata (`src/routes/__root.tsx`)

```
charSet: utf-8
viewport: width=device-width, initial-scale=1, viewport-fit=cover   ← viewport-fit=cover enables env(safe-area-inset-*)
theme-color: #000000
title: "Vault — Private Gallery"
description / og:title / og:description / og:type=website / twitter:card=summary
links: styles.css, preconnect fonts.googleapis.com + fonts.gstatic.com (crossOrigin anonymous),
       Google Fonts: Space Grotesk 500/600/700 + Inter 400/500/600 (display=swap)
```

Fonts are loaded via `<link>` in the route head — **never** via `@import` in `styles.css` (Tailwind v4 Lightning CSS resolves imports from the filesystem).

### 1.9 Android Gradle / SDK

`android/variables.gradle`: `minSdkVersion 24`, `compileSdkVersion 35`, `targetSdkVersion 35`, appcompat `1.7.0`, core `1.13.1`, coordinatorlayout `1.2.0`, core-splashscreen `1.0.1`, webkit `1.11.0`, cordova-android `10.1.1`.

`android/app/build.gradle`: namespace `app.lovable.privacygallery`, `multiDexEnabled true`, Java **17** source/target compatibility, `minifyEnabled false` for release, deps: `androidx.multidex:multidex:2.0.1`, capacitor projects, `META-INF/*` packaging excludes.
`android/app/capacitor.build.gradle` (generated) pins Java 21 compileOptions for the Capacitor layer and links `capacitor-filesystem`, `capacitor-preferences`.

### 1.10 CI (`.github/workflows/build.yml`)

Triggers: push to `main`/`master`, `workflow_dispatch`. Steps: checkout → setup-bun (latest) → setup-java **zulu 21** with gradle cache → setup-android → `sdkmanager --install platform-tools "platforms;android-35" "build-tools;35.0.0"` → `bun install` → `bun run build:capacitor` → **XML validation gate** (a Python step that `ET.parse`s every manifest and `res/**/*.xml`, and asserts the manifest contains `MultiDexApplication`) → `chmod +x android/gradlew` → `./gradlew :app:assembleDebug` from `working-directory: ./android` → upload artifact from `android/app/build/outputs/apk/debug/*.apk`.

> `android/gradlew` is **patched**: the stock script overwrote command-line arguments and silently ran the `help` task. Do not regenerate it from a stock Gradle distribution without re-applying the fix.

---

## 2. APPLICATION LOGIC & DATA FLOW

### 2.1 State management — no Redux/Zustand/Context; five hand-rolled `useSyncExternalStore` stores

Every store follows the identical pattern: module-level `state`, a `listeners: (() => void)[]` array, `emit()`, a `localStorage`-backed `persist()/hydrate()`, a **cached snapshot object** (required — returning a fresh object from `getSnapshot` makes React loop forever), and a distinct **server snapshot** constant for SSR.

| Store | File | localStorage key | Slice contents |
|---|---|---|---|
| **Vault store** | `src/lib/vault-store.ts` | `vault.store.v3` | `folders: VaultFolder[]`, `crypto: VaultCryptoSecrets \| null`, `biometricsEnabled: boolean` (default `true`), `theme: "system"\|"light"\|"dark"` (default `"dark"`), `unlocked: boolean` (**never persisted** — stripped in `persist()` and forced to `false` in `hydrate()`) |
| **Device scan** | `src/lib/device-scan.ts` | *(RAM only)* | `albums: ScannedAlbum[]`, `scanning: boolean`, `scanned: boolean` |
| **View prefs** | `src/lib/view-prefs.ts` | `vault.viewprefs.v1` | Per scope `"folders"` (default `columns:2, field:"created", dir:"desc"`) and `"media"` (default `columns:3, created, desc`) |
| **Legacy sort** | `src/lib/sort-prefs.ts` | `vault.sort.v1` | `Record<scope, "default"\|"name"\|"date"\|"size">` — superseded by view-prefs, still present |
| **Photo flags** | `src/lib/photo-flags.ts` | `vault.photo.protected.v1`, `vault.photo.names.v1` | Per-item delete-protection set and rename overrides |
| **Safe PIN gate** | `src/lib/pin-store.ts` | `vault.safe.pin.v1` (+ `sessionStorage` `vault.safe.unlocked.session`) | `{ salt, hash }` SHA-256 UI gate + per-session unlocked flag |
| **Language** | `src/lib/i18n.ts` | `vault.lang` | Active `Lang` code |

`liveFileKey: CryptoKey | null` in `vault-store.ts` is deliberately a **module-scope RAM-only variable**, never serialized, wiped by `vault.lock()`.

### 2.2 Routing

File-based, generated into `src/routeTree.gen.ts` (**never edit by hand**).

| File | Route id | Purpose |
|---|---|---|
| `src/routes/__root.tsx` | root | `<html>` shell, head metadata, bootstrap error script, `QueryClientProvider`, Capacitor hydration gate, `initBackHandler()`, 404 + error components |
| `src/routes/index.tsx` | `/` | Gallery home: album grid, triggers `deviceScan.scan()`, re-scans on `visibilitychange` / `focus` |
| `src/routes/gallery.$folder.tsx` | `/gallery/$folder` | Album detail: virtualized media grid, multi-select, share, delete, and the full-screen **MediaViewer + editor** (1063 lines — the largest module) |
| `src/routes/safe.index.tsx` | `/safe` | Encrypted Safe home: PIN/password gate (`AuthPrompt`), folder tiles, create/rename/delete |
| `src/routes/safe.$folder.tsx` | `/safe/$folder` | Safe folder: gallery picker import, encrypted grid, decrypt-to-view, restore, delete |
| `src/routes/settings.tsx` | `/settings` | Language, theme, biometrics toggle, storage usage, password row, privacy policy |

- **Search params:** `/gallery/$folder` validates `search.filter` into `"all" | "photo" | "video"` and filters items by `kind` in a `useMemo`.
- **Protection:** there is no route-level auth wrapper. The Safe is protected *inside* the component tree by `SafePinGate` / `AuthPrompt`, which refuse to render children until `vault.isUnlocked()`.
- **Layout wrapper:** `AppShell` (not a route) is used by each screen and renders a `max-w-md` content column with `pb-20` → `BottomNav`.
- **History:** `src/router.tsx` picks **hash history** when `Capacitor.isNativePlatform()` (mandatory under `file://`), **browser history** otherwise, and `undefined` during SSR. `scrollRestoration: true`, `defaultPreloadStaleTime: 0`.

### 2.3 Data fetching & external services

- **No REST/GraphQL/Supabase/Firebase calls exist anywhere in `src/`.** The only network traffic is Google Fonts (`<link>` in head).
- All "data" is produced locally by `deviceScan` (filesystem walk) and `vault-store` (encrypted local blobs).
- `src/server.ts` is the **web-only** SSR entry: it lazily imports `@tanstack/react-start/server-entry`, and contains `normalizeCatastrophicSsrResponse()` which detects h3's swallowed `{"unhandled":true,"message":"HTTPError"}` 500 JSON and replaces it with a rendered HTML error page from `src/lib/error-page.ts` (with the real error recovered via `consumeLastCapturedError()` from `src/lib/error-capture.ts`).
- `src/start.ts` registers a `requestMiddleware` `errorMiddleware` that re-throws framework redirect/status objects but converts any other throw into a 500 HTML error page.

---

## 3. DATABASE, STORAGE & SECRETS

### 3.1 Database

**None.** No SQL, no Supabase/Lovable Cloud, no IndexedDB, no ORM, no migrations, no RLS. All persistence is `localStorage` + the Android private filesystem.

### 3.2 Environment variables

| Name | Where | Purpose |
|---|---|---|
| `CAPACITOR_BUILD` | build-time shell env | `"1"` switches Vite into Capacitor SPA mode (base `./`, es2019, prerender, no Nitro) |
| `import.meta.env.VITE_CAPACITOR_BUILD` | client + prerender | `"1"` in native builds; read by `__root.tsx` to gate hydration |

**There are no secret keys, no `.env` file, no API tokens and no advertising identifiers in this project.**

### 3.3 Local storage map (complete)

| Key | Store | Shape |
|---|---|---|
| `vault.store.v3` | localStorage | `{ folders, crypto, biometricsEnabled, theme }` — `unlocked` deliberately excluded |
| `vault.viewprefs.v1` | localStorage | `{ folders: {columns,field,dir}, media: {columns,field,dir} }` |
| `vault.sort.v1` | localStorage | `Record<scope, SortKey>` |
| `vault.photo.protected.v1` | localStorage | `Record<itemId, true>` |
| `vault.photo.names.v1` | localStorage | `Record<itemId, string>` |
| `vault.safe.pin.v1` | localStorage | `{ salt: hex, hash: hex }` SHA-256(`salt + ":" + pin`) |
| `vault.safe.unlocked.session` | **sessionStorage** | `"1"` while the Safe UI gate is open this session |
| `vault.lang` | localStorage | active language code |

### 3.4 Device storage

**Encrypted vault directory:** `<app internal data>/nova_vault/` created by `SecureVaultPlugin.ensurePrivateDir()`, containing a `.nomedia` marker (written twice — natively and again from JS via `Filesystem.writeFile`) so the MediaStore indexer and every file manager ignore it. Per-folder subdirectories `nova_vault/<folderId>/`, one file per item named `<uuid>.enc` holding **base64 AES-256-GCM ciphertext**. Written with `Directory.Data`.

**Metadata** for each encrypted file lives in `vault.store.v3`:
```ts
EncryptedFile = { id, name, size /*plaintext bytes*/, type, addedAt,
                  iv /*b64*/, cipher? /*b64, WEB ONLY*/,
                  blobPath? /*native only*/, origPath? /*absolute source path for Restore*/ }
VaultFolder   = { id, name, createdAt, files: EncryptedFile[] }
```
On **web** the ciphertext is inlined in `cipher`. On **native** `cipher` is omitted and the bytes are moved to `blobPath` so localStorage never bloats.

**Public media** is read (never copied) from `Directory.ExternalStorage` roots: `DCIM`, `Pictures`, `Movies`, `Download`, `Documents`.

**Thumbnail cache:** in-memory bounded LRU `Map<id, blobURL>` in `src/lib/thumbnails.ts`, `MAX_ENTRIES = 400`, evicted URLs are `URL.revokeObjectURL`'d.

**Share staging:** `SecureVaultPlugin.stageCacheFile()` writes into the app cache dir and exposes it through `FileProvider` authority `${applicationId}.fileprovider` with `res/xml/file_paths.xml` = `<external-path name="my_images" path="."/>` + `<cache-path name="my_cache_images" path="."/>`.

### 3.5 Cryptography (`src/lib/crypto.ts`) — exact parameters

- **KDF:** PBKDF2-SHA-256, `PBKDF2_ITERATIONS = 210_000` (OWASP 2023), `SALT_BYTES = 16`.
- **Cipher:** AES-GCM, `KEY_BITS = 256`, `IV_BYTES = 12`, a **fresh random IV per operation**.
- **Key hierarchy:** password → KEK (PBKDF2) → wraps a random, per-vault **file key** (`crypto.subtle.wrapKey("raw", …)`). Files are encrypted with the file key, never with the password key.
- **Verifier:** AES-GCM ciphertext of the constant plaintext `"nova.vault.v1"`; decrypting it is the wrong-password check, and it runs **before** the unwrap so a bad password fails fast.
- **`unlockVault()`** unwraps with `extractable = false`. **`rewrapWithNewPassword()`** unwraps with `extractable = true` only long enough to re-wrap under a new salt/KEK — **changing the password never re-encrypts a single media file**.
- Persisted `VaultCryptoSecrets = { salt, iterations, wrappedKey, wrapIv, verifier, verifierIv }` — all base64, **zero plaintext**.
- TypeScript workaround: helpers `ua()`, `bs()`, `copyAB()` force `Uint8Array<ArrayBuffer>` because TS 5.7+ narrowed `BufferSource` and rejects `Uint8Array<ArrayBufferLike>` in SubtleCrypto calls.

---

## 4. MICRO-FEATURES, UTILITIES & CUSTOM HOOKS

### 4.1 Custom hooks (complete list)

| Hook | File | Behaviour |
|---|---|---|
| `useVault(selector)` | `vault-store.ts` | Selector subscription to the vault slice; hydrates on first client read |
| `useDeviceScan(selector)` | `device-scan.ts` | Per-hook-instance `(state, value)` memo cache so `useSyncExternalStore` sees a stable snapshot between emits |
| `useViewPrefs(scope)` | `view-prefs.ts` | `[prefs, patch]` tuple, persisted |
| `useSort(scope)` | `sort-prefs.ts` | Legacy sort tuple |
| `usePhotoFlags()` | `photo-flags.ts` | Protection + rename overrides |
| `useSafePin()` | `pin-store.ts` | `{ hasPin, unlocked }` with cached snapshot |
| `useLang()` / `useT()` | `i18n.ts` | Active language + translator function |
| `useApplyTheme()` | `theme.ts` | Toggles `.light`/`.dark` on `<html>`; subscribes to `prefers-color-scheme` only when theme is `"system"` |
| `useBackHandler(active, fn)` | `back-handler.ts` | LIFO hardware-back registration |
| `useAutoDetectLanguage()` | `AppShell.tsx` | On first launch only (`!hasLang()`), matches `navigator.language` prefix against `LANGS`, falls back to `en` |
| `useSystemStatusBar()` | `AppShell.tsx` | Native only; **lazily** `import("@capacitor/status-bar")`, then `setOverlaysWebView({overlay:false})`, `setStyle(Style.Dark)`, `show()`; all failures swallowed |
| `useIsMobile()` | `hooks/use-mobile.tsx` | shadcn breakpoint helper |

### 4.2 Utility functions (complete)

**`src/lib/utils.ts`** — `cn(...)` = `twMerge(clsx(...))`.

**`src/lib/device-scan.ts`**
- `IMG = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i`, `VID = /\.(mp4|mov|m4v|webm|mkv|3gp|avi)$/i`.
- `guessMimeFromName(name)` — explicit extension→MIME table (jpg, jpeg, png, gif, webp, heic, heif, avif, bmp, mp4, mov, m4v, webm, mkv, 3gp, avi), default `application/octet-stream`.
- `materializeFile(item)` — lazily reads a native URI through `Filesystem.readFile`, base64-decodes into a `Uint8Array`, builds a real `File`, and **caches it back onto the item** so repeated share/import operations do not re-read.
- `albumKey(path)` — album name = the **immediate parent directory name** (matching Google Photos / MIUI / Samsung grouping). Falls back to `"Root"`.
- `toItem(file, path)` — id = `` `${path}:${size}:${lastModified}` ``.
- `group(items)` — albums sorted by item count desc; items inside sorted by `mtime` desc; album id = lowercased name with whitespace → `-`.
- `walkDir` (File System Access API, yields to the event loop with `setTimeout(0)` between directories), `walkNative` (Capacitor `readdir` recursion, **skips any directory starting with `.`**, resolves a URI via `Filesystem.getUri` when the entry lacks one, exposes it through `Capacitor.convertFileSrc`).
- `scanNative()` / `scanWithPicker()` / `scanWithInput()` — the three-tier strategy; `deviceScan.scan()` tries them in that order.
- `removeByPaths(paths)` — normalizes away `file://`, matches on native URI, relative path, or suffix `/path`; revokes only `blob:` URLs; drops now-empty albums. Used after a secure move into the Safe.
- `removeItems(albumId, ids)` — same but scoped to one album.
- `revokeAll()` — bulk `URL.revokeObjectURL` before replacing the album set.

**`src/lib/thumbnails.ts`** — `MAX_EDGE = 256`, WebP quality `0.72`, `OffscreenCanvas` when available with an `HTMLCanvasElement` fallback, `createImageBitmap` + `bitmap.close?.()`. `renderVideoPosterFromUrl()` seeks to `min(0.1s, duration*0.05)` to avoid a black first frame. Native **images** forward the original URL (the WebView decoder is faster and caches); native **videos** must be poster-extracted because `<img src="video.mp4">` renders broken. An `inFlight` map deduplicates concurrent requests; every failure falls back to the original URL (HEIC decode failures are expected).

**`src/lib/view-prefs.ts`** — `sortRows(rows, field, dir)` copies before sorting (never mutates), maps `created→createdAt??mtime`, `modified→mtime??createdAt`, `size→size??0`, `name→lowercased`, uses `localeCompare` for strings and falls back to `name.localeCompare` as a stable tiebreaker.

**`src/lib/i18n.ts`** — 10 languages: `en, ru, kk, pt, es, fr, ar, zh, ja, ko` with `label`/`native` display names. `T` is a `Record<key, Partial<Record<Lang,string>> & { en: string }>` so **English is a compile-time-required fallback** for every key. Keys cover navigation, folder CRUD, PIN flows (`enter_pin`, `set_pin`, `confirm_pin`, `pin_mismatch`, `pin_wrong`, `pin_must_be_4`), viewer actions (`flip_h`, `flip_v`, `reset`, `apply`, `saved`, `wallpaper_set`, `format`), destructive confirmations (`confirm_delete_photo`, `confirm_delete_video`), and Safe restore (`restore`, `restored`, `restore_failed`).

**`src/lib/native-vault.ts`** — typed bridge to `SecureVault` with a **complete no-op implementation** substituted on web (`Capacitor.isNativePlatform()` false), so no call site ever needs a platform check. Exposes `isNative()`, `ensurePrivateVaultDir()`, `ensureDeletePermission()`, `deleteOriginals()`, `setWallpaper()`, `setWallpaperSafely()`, `saveEditedImage()`, `shareNative()`, `restoreToPublic()`.

**`src/lib/mock-gallery.ts`** — pure CSS-gradient placeholder data (no external images) used for design/preview.

**`src/lib/error-capture.ts` / `error-page.ts` / `lovable-error-reporting.ts`** — SSR error capture, static HTML error page renderer, and boundary reporting from the root `errorComponent`.

### 4.3 Permission flow (exact sequencing)

Permissions are **never** requested from JavaScript. The order is enforced natively:

1. Cold start → `MainActivity.onCreate` registers `SecureVaultPlugin` and applies the transparent status bar.
2. `requestMediaPermissions()` fires after `PERMISSION_DELAY_MS = 500` ms, guarded by `mediaPermissionsRequested`, request code `MEDIA_PERM_REQUEST_CODE = 4917` — always **before** any JS storage query.
3. Requested set is API-level aware: `READ_MEDIA_IMAGES` + `READ_MEDIA_VIDEO` + `READ_MEDIA_VISUAL_USER_SELECTED` on 13+, `READ_EXTERNAL_STORAGE` (maxSdk 32) / `WRITE_EXTERNAL_STORAGE` (maxSdk 29) below.
4. `MANAGE_EXTERNAL_STORAGE` is requested **lazily and only once**, on the first secure-move into the Safe, via `ensureDeletePermission()` → `SecureVault.hasAllFilesAccess()` → `requestAllFilesAccess()`. A denial is **not fatal**: `deleteOriginals()` then falls back to a single `MediaStore.createDeleteRequest` system dialog covering the whole batch (`DELETE_REQUEST_CODE = 7311`).

### 4.4 Gesture & interaction handling

- **Hardware back (`src/lib/back-handler.ts`):** a single global `App.addListener("backButton")` wired once by `initBackHandler()` (idempotent via a `wired` flag). Handlers live in a LIFO `stack`; `runStack()` iterates **top-down** and treats any return value other than `false` as "handled". A throwing handler is caught, logged (`[back] handler threw`) and treated as handled to avoid accidental app exit. If nothing handles the press: `history.back()` when possible, otherwise `App.exitApp()`. On web, **Escape** is bound to the same stack for preview parity.
  Layer order in practice: viewer overlay/details/confirm → full-screen viewer → folder screen → gallery/safe home → exit.
- **Selection:** long-press/tap enters `selectMode` with a `Set<string>` of ids; `enterSelect()` / `cancelSelect()` reset the set.
- **Drawing (`DrawLayer`):** pointer events on a `<canvas>`, coordinates normalized to 0–1 against `getBoundingClientRect()` so strokes survive resize; a `ResizeObserver` re-measures; `paintStrokes()` re-scales stroke width by `Math.min(w,h)/400` when baking.
- **Virtualized grid (`VirtualizedGrid` in `gallery.$folder.tsx`):** hand-written windowing — `ResizeObserver` measures tile size from `clientWidth - 8` (accounting for `p-1`), a scroll listener computes a visible `[start, end]` range with `OVERSCAN = 6` rows.
- **Media viewer chrome:** tap toggles `chromeVisible`; edit state is `rotation` (0/90/180/270), `flipH`, `flipV`, `tool: "none"|"draw"|"filters"`, `preset: FilterPreset`, `brightness`/`contrast` (100 = neutral), `strokes`, `brush` size, `color` (default `#ff3b30`).
- **Editing pipeline (`renderEdited`)**: loads the image, swaps canvas dimensions for 90/270 rotations, applies the CSS `filter` string, draws strokes, and exports `toDataURL("image/jpeg", quality)` with **quality `0.45` for the `compress` preset and `0.92` otherwise**. `PRESET_CSS` maps each preset (`none`, vintage, B&W, compress …) to a CSS filter string, reused for both live preview and baking so WYSIWYG holds.
- **Error surfacing:** `sonner` toasts for user-facing outcomes; the root `errorComponent` for render crashes; the inline bootstrap script (§5.2) for pre-hydration crashes.

### 4.5 Safe import / restore flows (step by step)

**Import (secure move), `safe.$folder.tsx`:**
1. `GalleryPicker` lists scanned device media with a selection `Set`.
2. `ensurePrivateVaultDir()` and, on first use, `ensureDeletePermission()`.
3. For each selection: `materializeFile(item)` → `vault.addFiles(folder.id, [file], [{ origPath: item.path }])` → AES-256-GCM encrypt → write `nova_vault/<folderId>/<uuid>.enc`.
4. Collect the source paths → `deleteOriginals(paths)` (native, permanent, removes both the file and the MediaStore row).
5. `deviceScan.removeByPaths(deleted)` so the gallery UI reflects the move without a full re-scan.

**Restore:** `vault.decryptFile(f)` → blob → `blobToBase64()` → `restoreToPublic({ base64, name, mime, relativePath: publicRelativeDir(f) })` (derived from `origPath`, e.g. `DCIM/Camera`) → `vault.deleteFile(folder.id, f.id)` → toast `restored` / `restore_failed`.

**View:** `vault.decryptFile()` produces an in-memory `Blob` + object URL; **no plaintext file is ever written to disk on native**. Sharing decrypted media therefore goes through `shareNative({ base64 })`, not a path.

---

## 5. NON-STANDARD SOLUTIONS & WORKAROUNDS (CRITICAL)

Every item below is a deliberate fix for a reproduced device bug. **Do not "clean up" any of them without re-testing on Android 9 and Android 14 hardware.**

### 5.1 `capacitorRelativeAssetsPlugin()` — post-build HTML/JS surgery
Runs in `closeBundle`, walks `dist/client` (`.html .js .mjs .cjs .css .map`) and:
- Rewrites `/./assets/` **before** `/assets/` (TanStack emits the former when `base` is `./`) into `./assets/`, across quote/paren/`=` contexts, `url(...)` contexts and bare occurrences. Under `androidScheme: "file"` a leading `/` resolves to the **device filesystem root** and 404s.
- Strips `<base href="/">`.
- **Empties `<div id="root">…</div>`** so the WebView boots a truly empty container. TanStack's prerender emits Suspense hydration markers (`<!--$-->…<!--/$-->`) plus a scroll-restoration script; hydrating those against a client tree that renders `null` on the first pass still produced **"Minified React error #418"** on older Chromium WebViews.
- Removes the TanStack streaming-barrier `<script class="$tsr">`.
- Logs `[capacitor-relative-assets] rewrote N file(s) in dist/client`.
> The `outDir` is `dist/client` on purpose — pointing it at `dist` corrupts the prerender server files.

### 5.2 Triple-layered legacy-WebView polyfilling
1. **Inline `BOOTSTRAP_ERROR_HANDLER`** — the first `<script>` in `<head>` (`__root.tsx`), written in ES5. It installs `String.prototype.replaceAll`, `String.prototype.at`, `Array.prototype.at`, `Object.hasOwn` *before any bundle is parsed*, then registers `error` / `unhandledrejection` listeners that paint a self-contained dark "Nova Gallery couldn't start / Restart" screen (guarded by `data-nova-error="1"` so it paints once).
2. **`src/polyfills.ts`** — the same four polyfills, spec-accurate (global-RegExp check, empty-search-string branch, function-replacement branch), each guarded by `if (typeof … !== "function")`. **Imported as the very first line of `src/router.tsx`**, ahead of React and every third-party module. Moving this import breaks Android 9.
3. **esbuild `class-field: false`** — syntax-level down-levelling, since esbuild's `target` does *not* inject runtime method polyfills.

### 5.3 The Capacitor hydration gate (`__root.tsx`)
`const isCapacitor = import.meta.env.VITE_CAPACITOR_BUILD === "1"; const [hydrated, setHydrated] = useState(!isCapacitor);` — in native builds both the prerender and the first client render return `null` for the app subtree, so the hydration diff is empty; a `useEffect` then flips it to `<Outlet />`. Required because language (localStorage), `Capacitor.isNativePlatform()`, persisted stores, and the browser→hash history switch all legitimately differ between prerender and runtime. **The web build is unaffected** and keeps full SSR/SEO.

### 5.4 Status bar / safe area
- Theme (`res/values/styles.xml`): transparent `statusBarColor`, `windowDrawsSystemBarBackgrounds true`, `windowTranslucentStatus/Navigation false`, `windowLayoutInDisplayCutoutMode shortEdges` (API 27+), splash theme `Theme.SplashScreen` with `postSplashScreenTheme` → `AppTheme`.
- Native: `applyTransparentStatusBar()` + `WindowCompat.setDecorFitsSystemWindows(window, true)`.
- JS `useSystemStatusBar()` (AppShell): `setOverlaysWebView({ overlay: false })`; `setStyle` = `Style.Light` (dark icons) in the light theme, `Style.Dark` (light icons) in the dark theme; `setBackgroundColor` = the current `--color-background` converted to `#rrggbb` (`cssColorToHex`). Re-applied whenever the theme or the `<html>` class changes.
- Safe-area tokens in `src/styles.css`: `--app-safe-top` / `--app-safe-bottom` = `max(env(safe-area-inset-*), var(--safe-area-inset-*))`. The second value is the CSS variable Capacitor 8 injects on Android, where older WebViews report `env()` as 0 under the forced edge-to-edge of Android 15+ (targetSdk 36).
- `AppShell` pads its frame by `--app-safe-top` on every platform (0 on Android ≤14 because the WebView already sits below the bar; the real bar height on Android 15+ and iOS). Only the frame pads — `ScreenHeader` uses a plain `pt-2`, so there is never a double inset.
- Full-screen layers outside the frame use the same token: photo viewer top bar (`gallery.$folder`), Safe viewer top bar (`safe.$folder`), `SafePinGate`, Privacy Policy dialog. Bottom bars use `--app-safe-bottom` (bottom nav, viewer bottom bar, info sheet).

### 5.5 Anti-letterboxing on tall screens
`AndroidManifest`: `android:resizeableActivity="true"` on both `<application>` and `<activity>`, plus `android.max_aspect = 2.4` and `android.min_aspect = 1.0` meta-data. CSS: duplicated `min-height: 100vh; min-height: 100dvh` on `html`, `body`, `#root`.

### 5.6 Google AdMob integration (native only)
All ad code is gated by `Capacitor.isNativePlatform()`; the web preview renders only the placeholder tile.

| Format | Unit ID | Owner |
|---|---|---|
| App ID | `ca-app-pub-9902253594429663~9587409077` | `AndroidManifest.xml` meta-data `com.google.android.gms.ads.APPLICATION_ID`; `ADMOB_APP_ID` in `src/lib/native-ads.ts` |
| Native Advanced | `ca-app-pub-9902253594429663/3903747602` | `NATIVE_AD_UNIT_ID` in `src/lib/native-ads.ts` → `NativeAdsPlugin.java` |
| Top banner | **removed** | — |
| App Open | **removed** | — |

The only ad is the native ad in the first gallery tile (§6.1). The top banner, `src/lib/ads.ts`, `TopBannerSpacer`, the banner height store and the `@capacitor-community/admob` package (plus its Gradle module and `capacitor.plugins.json` entry, and the `plugins.AdMob` block of `capacitor.config.ts`) are gone. The Google Mobile Ads SDK (`play-services-ads`, version in `variables.gradle`) is used directly by `NativeAdsPlugin.java`; `NativeAdsPlugin.load()` calls `MobileAds.initialize()` once on a background thread — the only SDK initialization in the app; `MainActivity` has no ad code. The prebuilt web bundle in `android/app/src/main/assets/public` was regenerated so the APK no longer carries old banner / App Open code.

### 5.7 Native plugins registered in `MainActivity`
`registerPlugin(SecureVaultPlugin.class)`, `registerPlugin(NativeAdsPlugin.class)` — all before `super.onCreate()`.

### 5.7a `SecureVaultPlugin.java` — the bespoke native bridge
Registered manually in `MainActivity`; not a published Capacitor plugin. `VAULT_DIR = "nova_vault"`, a `static instance`, and `pendingDeleteCall` / `pendingDeletePaths` to resume across `onActivityResult`.
`@PluginMethod`s: `ensurePrivateDir`, `hasAllFilesAccess`, `requestAllFilesAccess`, `deleteOriginals`, `setWallpaper`, `shareFile`, `restoreFile`, `saveImage`.
Internals: `normalize()` strips URI prefixes; `pathFromContentUri()` and `findMediaUri()` translate between absolute paths and MediaStore rows; `decodeSampled()` downsamples to `MAX_WALLPAPER_EDGE = 2560` **on a worker thread** (this is the fix for the wallpaper freeze); `stripDataUrl()` tolerates `data:` prefixes on base64 input; `sanitize()` + `stageCacheFile()` + `providerUri()` implement FileProvider sharing.
`setWallpaperSafely()` on the JS side tries the on-device path first and only then falls back to lazily produced base64 — it **never throws**.

### 5.8 Other codebase-specific rules
- **`useSyncExternalStore` snapshot caching is mandatory.** Every store returns a memoized object; returning a fresh object literal from `getSnapshot` causes an infinite render loop. `device-scan` caches per hook instance, `view-prefs`/`pin-store` cache at module scope.
- **`pin-store.ts` monkey-patches its own exports** (`setPin`, `lock`, `reset`, `verify` are reassigned after definition) so cache invalidation happens *before* listeners are notified. Do not "simplify" this away.
- **`vault.unlocked` must never be persisted.** It is stripped in `persist()` and forced to `false` in `hydrate()`; `liveFileKey` is RAM-only.
- **Modal freezes:** confirmation sheets are rendered through a **React Portal at `z-[9999]` with `pointer-events: auto`** (`ConfirmSheet`), replacing Radix dialogs which deadlocked inside the full-screen viewer. The Safe viewer likewise uses a custom full-screen layer, not Radix `Dialog`.
- **Deleting the last item of an album** must navigate to the parent route *before* the delete, otherwise the screen renders an "Album unavailable" state (`deleteFromViewer` computes `last` up front).
- **Never edit `src/routeTree.gen.ts`.** Never re-add `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths` or `nitro` plugins to `vite.config.ts`.
- **`android/app/src/main/assets/public/**` is generated** by `cap sync`; edit `src/` and rebuild instead.
- The UI is deliberately **compact**: `max-w-md` content column, `min-h-8` headers, reduced paddings, shrunken PIN pad and bottom nav. Keep new UI inside that visual budget.
- Design tokens only — no hardcoded `text-white` / `bg-black` / `bg-[#…]` utilities; the whole palette is OKLCH variables with a `.light` override.


---

## 6. CHANGES IN THIS VERSION

### 6.1 Native Advanced ad — always the first gallery item
**Files:** `src/lib/native-ads.ts` (new), `src/components/NativeAdTile.tsx` (new), `android/app/src/main/java/app/lovable/privacygallery/NativeAdsPlugin.java` (new), `src/routes/index.tsx`, `MainActivity.java`.

- **Ordering rule:** `FolderGrid` renders `<NativeAdTile />` as its first child, then every album/folder (system or user, photos and videos) in the user's sort order. The grid is rendered in every state — while scanning, with results, and when a filter has no matches — so the ad is always item #1. The "Nothing found" text and the scanning spinner appear *below* the grid.
- **Tile geometry:** `gridColumn: 1 / -1` (spans the whole row for every column count 2–5), height `NATIVE_AD_TILE_HEIGHT = 140` px, `rounded-3xl`, surface background + border tokens. Before an ad is loaded (and in the web preview) it shows a pulsing media placeholder, the localized "Ad" badge (`ad_label`) and "Sponsored" caption (`ad_sponsored`); `aria-label` is `ad_sponsored`.
- **Rendering model:** AdMob native ads must be drawn in a real `NativeAdView`, so the Java plugin builds one programmatically and lays it over the WebView exactly where the tile is. Layout: `MediaView` (120dp, center-crop) on the left; on the right an "Ad" badge + app icon (18dp), headline (13sp bold, 2 lines), body (11sp, 2 lines), call-to-action button (30dp, right-aligned). AdChoices is placed top-right by the SDK. Registered asset views: media, headline, body, icon, call-to-action.
- **Clipping:** the ad view sits inside a clipping `FrameLayout` that covers only the area between the bottom of the sticky header (`[data-sticky-header]` on the Gallery header block) and the top of the bottom navigation (`[data-bottom-nav]` — a language-independent attribute; the translated `aria-label` is not used as a selector), intersected with the scroll container. The ad therefore never paints over the header, filter tabs or bottom nav.
- **Position sync:** `NativeAdTile` measures itself with `getBoundingClientRect()` and calls `NativeAds.setBounds({ x, y, width, height, clipTop, clipBottom, visible, label, colors })` (CSS px; the plugin multiplies by display density). Updates are coalesced into one `requestAnimationFrame` and triggered by the scroll container's `scroll`, window `resize`, a `ResizeObserver` on the tile, theme class changes on `<html>`, and DOM mutations in `<body>`.
- **Menus and dialogs win:** whenever a Radix popper, dialog, alert dialog, menu or listbox exists in the DOM, `visible: false` is sent and the overlay is hidden, so the "View options" dropdown and every sheet stay usable.
- **Theming:** `readThemeColors()` converts the CSS tokens `--color-surface`, `--color-border`, `--color-foreground`, `--color-muted-foreground`, `--color-accent`, `--color-accent-foreground` to `#rrggbb` via a 1×1 canvas and passes them to the plugin (card background, 24dp corners, 1dp border, accent badge and button). Switching light/dark updates the ad immediately.
- **Localization:** the native badge text is sent from JS (`t("ad_label")`), so it follows the 17-language setting. New keys in every locale file: `ad_label`, `ad_sponsored`.
- **Why the ad stayed an empty block (fixed):** (1) the bridge method was named `load`, the same name as Capacitor's `Plugin.load()` lifecycle hook overridden in the same class — renamed to `loadAd`; (2) after the 15 s timeout the plugin cleared its in-progress flag while the first AdMob request was still running, so every retry started a parallel request and late results raced each other — the flag now stays set until AdMob answers, late failures are reported as `adFailed`, late fills as `adLoaded`; (3) the overlay frame had no elevation, so on parents that order children by elevation the WebView could draw over it — the frame now sits above the WebView (`setElevation` + `setTranslationZ` + `bringToFront`); (4) the bottom-nav lookup used the English `aria-label`, so in every other language the clip area ignored the bottom nav — replaced by `[data-bottom-nav]`. Native logcat tag `NativeAds` logs every fill/failure.
- **Loading & retries (exponential backoff):** `loadNativeAd()` runs on tile mount; one request at a time. Before each request `NativeAds.isOnline()` checks the active network (`ConnectivityManager`: validated internet over Wi-Fi, mobile data or ethernet; fallback `navigator.onLine`). On failure (offline, `TIMEOUT`, AdMob error such as `3:No fill`) one retry is scheduled by `backoffDelay()` in `src/lib/backoff.ts`: 5 s, 10 s, 20 s, 40 s … doubling, capped at 5 min, ±20 % jitter; each delay is logged (`[ads] native ad retry #n in … ms (reason)`). The attempt counter resets to 0 after a fill. `networkAvailable` (native `NetworkCallback`, validated internet regained), the browser `online` event and `appStateChange → isActive` cancel the pending timer and retry immediately with a fresh schedule; no timers run while the app is in the background. `LOAD_IN_PROGRESS` queues nothing — the running request reports through `adLoaded` / `adFailed`. Unit tests: `src/lib/backoff.test.ts`. The loaded ad is cached in the plugin and reused across navigations; leaving the Gallery calls `hide()`; `destroy()` and `handleOnDestroy()` free the `NativeAdView` and the `NativeAd`. Native request options: AdChoices top-right, media aspect ratio ANY.
- **Plugin API (`NativeAds`):** `loadAd({ adId }) → { loaded, error? }`, `setBounds(bounds)`, `hide()`, `destroy()`, `isOnline() → { online }`; events `networkAvailable`, `adLoaded`, `adFailed { error }`.
- **Store:** `subscribeNativeAd` / `getNativeAdLoaded` / `getServerNativeAdLoaded` (`useSyncExternalStore`, SSR snapshot `false`).

### 6.2 No full-screen ad at launch
See §5.6: there is no App Open ad and no cooldown timer.

### 6.3 Settings → Language picker
**File:** `src/routes/settings.tsx`.
- The language `SelectContent` now uses `position="popper"`, `side="bottom"`, `align="end"`, `sideOffset={6}`, `collisionPadding={12}`, `avoidCollisions={false}` (always opens downward, right-aligned to the 140px trigger).
- Height is capped at `min(13.5rem, available height)` — about six languages — so the list stays compact and does not cover the whole Appearance/Theme and Security groups.
- The list scrolls inside that box with smooth scrolling, touch momentum and `overscroll-contain` (scrolling the list never scrolls the page). Radix scroll-up/down chevrons appear at the edges when more items exist. All 17 native language names remain available; the current one is checked.
- The Theme picker (System / Light / Dark) is unchanged.

### 6.4 Current interactive elements (reference)
- **Gallery (`/`):** header "Gallery" + ⋮ View options (Sorting: name/created/modified/size, ascending/descending; Columns 2–5 — inline sections that expand downward); filter tabs All / Photos / Videos; grid = native ad tile, then folder cards (4-thumbnail preview, name, item count) linking to `/gallery/$folder?filter=…`.
- **Settings (`/settings`):** General → Language (17 languages); Appearance → Theme (System/Light/Dark); Security → Safe biometrics switch, Add/Change password (4-digit PIN), Safe storage usage bar; Privacy Policy screen (full width, from directly below the status bar down to the top edge of the bottom navigation — its bottom offset is measured from `nav[aria-label='Primary']` on open; header with title and round close button, scrollable body; closes via the X, the back gesture or Escape); version footer.
- **Bottom navigation:** Gallery, Safe, Settings.

### 6.5 Layout insets (this version)
- App frame (`AppShell`): `fixed inset-0` column, top padding `--app-safe-top`, background `--color-background` → the single scroll container → `BottomNav`. The top banner and its spacer are removed, so content starts directly under the status bar on every screen (Gallery, Safe, Settings and sub-views) and never hides beneath the status icons (see §5.4).
