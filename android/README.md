# Nova Gallery — Android build

## White-screen fix (root cause)

TanStack Start defaults to a **Nitro server** build (Cloudflare preset).
`.output/public` then contains only client chunks — no `index.html` — and
the Android WebView opens an empty directory, showing a permanent white
screen.

The Capacitor build path is now separate: setting `CAPACITOR_BUILD=1`
switches Nitro to the **`static`** preset with prerender enabled, so
`.output/public/index.html` is produced and the WebView can boot the app.

## Build the APK / AAB

```bash
# 1. Install deps (once).
bun install

# 2. Produce the static web build + sync into android/.
bun run build:capacitor

# 3. Debug APK.
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk

# 4. Release AAB for Play Store.
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

Or open Android Studio directly:

```bash
bun run android:open
```

## What guarantees no more white screen

1. **Static index.html present** — `CAPACITOR_BUILD=1` forces Nitro's
   `static` preset and prerenders `/`, `/safe`, `/settings`.
2. **Capacitor `androidScheme: 'https'`** — assets load from
   `https://localhost/...`, so the absolute `/assets/*` paths that Vite
   emits resolve correctly inside the WebView.
3. **Bootstrap error handler** — `src/routes/__root.tsx` injects a
   pre-bundle `<script>` that catches `error` and `unhandledrejection`
   before React mounts and paints a visible "Nova Gallery couldn't start"
   screen with a Restart button instead of freezing on white.
4. **Safe plugin init** — vault crypto calls are wrapped in `try/catch` and
   are no-ops on non-native platforms.

## SDK / Play Store compliance

- `compileSdk` / `targetSdk` = **35** (Android 15) — see
  `android/build.gradle`.
- Capacitor **8.4.x** (latest stable).
- Scoped Storage only — `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`, no
  `MANAGE_EXTERNAL_STORAGE`.
