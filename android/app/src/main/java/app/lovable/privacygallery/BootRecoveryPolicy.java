package app.lovable.privacygallery;

/**
 * Startup recovery is intentionally narrow. It never runs for an interactive
 * gallery or photo viewer, only after the native watchdog observed a stalled
 * local URL with no validated UI, and the app remains in the foreground.
 */
public final class BootRecoveryPolicy {
    private BootRecoveryPolicy() {}

    /** Observe API29/33 emulator renderer health without forcing software
     * before first paint. Keep bounded software recovery after proven failure.
     * Previous CI showed early software layer did not fix these blank screens. */
    public static boolean observeLegacyRendererOnEmulator(int sdk, boolean emulator) {
        return emulator && (sdk == 29 || sdk == 33);
    }

    public static boolean trySoftwareFallback(
            int webProgress, boolean hasValidatedReactGeometry, boolean alreadyAttempted) {
        return webProgress >= 90 && !hasValidatedReactGeometry && !alreadyAttempted;
    }
}
