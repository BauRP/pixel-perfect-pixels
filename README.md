# Nova Gallery

Offline, local-first Android gallery with an encrypted private Safe. React 19 + TanStack Start,
wrapped in Capacitor 8, with custom native plugins (`SecureVaultPlugin`, `NativeAdsPlugin`).
See `ARCHITECTURE.md` for the full design.

## Android 7–17 compatibility — dedicated workstream

- `minSdkVersion = 24` (Android 7.0), `compileSdkVersion = 37` (Android 17),
  `targetSdkVersion = 37` (Android 17 runtime behavior).
- AGP 9.2.0 + Gradle 9.4.1 + Kotlin plugin 2.4.20; CI installs Android SDK 37.
- Actual system status, gesture navigation, three-button navigation and cutout
  clearance is handled by the native `SystemInsetsPlugin` using `WindowInsetsCompat`.
- Full 14-version Android and display/nav-mode test matrix: [ANDROID_COMPATIBILITY.md](ANDROID_COMPATIBILITY.md).
- **Only SDK configuration and compilation are validated in CI. Runtime/device compatibility is not yet certified.**


## Advertising (Google AdMob — active)

The app ships **one Google AdMob Native Advanced ad** as the first tile of the gallery grid.
There are no banners, interstitials or app-open ads.

| Item | Value / location |
|---|---|
| AdMob app ID | `ca-app-pub-9902253594429663~9587409077` (`AndroidManifest.xml`) |
| Native ad unit (release) | `ca-app-pub-9902253594429663/3903747602` (`src/lib/native-ads.ts`) |
| Test unit (debug) | Google's `ca-app-pub-3940256099942544/2247696110`, chosen by `BuildConfig.USE_TEST_ADS` |
| JS scheduler / state machine | `src/lib/native-ads.ts` (retries via `src/lib/backoff.ts`) |
| Slot UI | `src/components/NativeAdTile.tsx` |
| Native rendering, UMP consent, connectivity | `android/.../NativeAdsPlugin.java` |

### Consent (Google UMP)
- Consent info is refreshed on every launch; the form shows only where Google requires it (EEA/UK/CH),
  according to the message published in AdMob → Privacy & messaging.
- Ads are requested only when `canRequestAds()` is true. `CONSENT_PENDING` / `CONSENT_REQUIRED` are
  consent states, not ad failures, and never trigger retries.
- Settings shows "Privacy settings" only when Google reports the entry point is required.
- **Debug builds only:** if consent has not resolved after 10 s, test ads are allowed so development
  isn't blocked. Release builds never bypass consent.
- Test regions in debug: `./gradlew assembleDebug -PumpDebugGeography=EEA -PumpTestDeviceId=<hashed id>`.

### Build flags
| Gradle property | Default | Effect |
|---|---|---|
| `adsNativeValidator` | `false` | `true` shows Google's native ad validator popup (debug only) |
| `adsAllowUnvalidated` | `true` | Release: request ads on networks Android hasn't validated (debug always tolerant) |
| `umpDebugGeography` / `umpTestDeviceId` | empty | Debug-only consent geography override |

### Diagnostics
Every ad state change is logged to the WebView console and to logcat:
`adb logcat -s NativeAds`. Debug builds also print the current state inside the placeholder tile.

### Builds
- `bun run build:capacitor` → web bundle + `cap sync android`.
- CI (`.github/workflows/build.yml`) builds a **signed release** when the `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets exist; otherwise a
  debug build (test ads only).


This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cc7317e0-9c7b-4fa2-86c4-db36f980633f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
