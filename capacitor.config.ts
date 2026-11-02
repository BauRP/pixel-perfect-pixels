import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.privacygallery",
  appName: "Nova Gallery",
  webDir: "dist/client",
  android: {
    allowMixedContent: false,
  },
  server: {
    // Capacitor 8 rejects file:// and silently switches to https://localhost.
    // Declare the real local origin explicitly to keep cold reloads stable.
    androidScheme: "https",
  },
};

export default config;
