import type { CapacitorConfig } from "@capacitor/cli";

// The AdMob App ID lives in AndroidManifest.xml (com.google.android.gms.ads.APPLICATION_ID);
// the Google Mobile Ads SDK is driven directly by NativeAdsPlugin.java.
const config: CapacitorConfig = {
  appId: "app.lovable.privacygallery",
  appName: "Nova Gallery",
  webDir: "dist/client",
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "file",
  },
};

export default config;
