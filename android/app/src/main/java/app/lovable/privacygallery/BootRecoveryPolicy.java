package app.lovable.privacygallery;

/**
 * Startup recovery is intentionally narrow. It never runs for an interactive
 * gallery or photo viewer, only after the native watchdog observed a stalled
 * local URL with no validated UI, and the app remains in the foreground.
 */
public final class BootRecoveryPolicy {
    private BootRecoveryPolicy() {}

    /**
     * Android 10/13 headless emulators exhibit a SwiftShader font-raster
     * compositor defect even when the Settings UI itself paints correctly.
     * Use software WebView composition on these disposable test devices
     * BEFORE the first render, not only after an unpainted watchdog sample.
     * Do not change real-phone rendering, or other Android SDK versions.
     */
    public static boolean preferSoftwareRendererOnEmulator(int sdk, boolean emulator) {
        return emulator && (sdk == 29 || sdk == 33);
    }

    public static boolean trySoftwareFallback(
            int webProgress, boolean hasValidatedReactGeometry, boolean alreadyAttempted) {
        return webProgress >= 90 && !hasValidatedReactGeometry && !alreadyAttempted;
    }
}
