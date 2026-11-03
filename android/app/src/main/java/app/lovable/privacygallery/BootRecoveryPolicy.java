package app.lovable.privacygallery;

/**
 * Startup recovery is intentionally narrow. It never runs for an interactive
 * gallery or photo viewer, only after the native watchdog observed a stalled
 * local URL with no validated UI, and the app remains in the foreground.
 */
public final class BootRecoveryPolicy {
    private BootRecoveryPolicy() {}

    public static boolean trySoftwareFallback(
            int webProgress, boolean hasValidatedReactGeometry, boolean alreadyAttempted) {
        return webProgress >= 90 && !hasValidatedReactGeometry && !alreadyAttempted;
    }
}
