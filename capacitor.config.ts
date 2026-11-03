import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.privacygallery",
  appName: "Nova Gallery",
  webDir: "dist/client",
  android: {
    allowMixedContent: false,
  },
  // Our registered SystemInsets plugin is the single source of truth for
  // status, navigation, cutout and keyboard geometry on Android 7–17.
  // Capacitor 8's default SystemBars "css" mode also writes parent padding
  // and injects safe-area CSS on Chromium <140, conflicting with our own
  // WindowInsetsCompat listener and risking calls into destroyed WebViews.
  // The 8.4.x runtime honors "disable": we explicitly own all OS insets.
  plugins: {
    SystemBars: { insetsHandling: "disable" },
  },
  server: {
    // Capacitor 8 rejects file:// and silently switches to https://localhost.
    // Declare the real local origin explicitly to keep cold reloads stable.
    androidScheme: "https",
  },
};

export default config;
