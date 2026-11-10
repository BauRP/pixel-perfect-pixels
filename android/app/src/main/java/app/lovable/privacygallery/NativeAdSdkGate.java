package app.lovable.privacygallery;

/**
 * Google Mobile Ads initialization can complete after React and Android
 * plugin registration. Serialize only the *ad request* until the SDK signals
 * readiness; never block the Android main thread or change ad placement.
 * Call on Android's main thread, except isReady() which is safe to query.
 */
final class NativeAdSdkGate {
    private volatile boolean ready;
    private Runnable pending;

    boolean isReady() {
        return ready;
    }

    void await(Runnable request) {
        if (ready) {
            request.run();
        } else {
            pending = request;
        }
    }

    void complete() {
        ready = true;
        Runnable request = pending;
        pending = null;
        if (request != null) request.run();
    }

    /** Ignore a timeout belonging to an older/replaced request. */
    boolean expire(Runnable request) {
        if (ready || pending != request) return false;
        pending = null;
        return true;
    }

    /** Drop a pending request after initialization fails. */
    boolean fail() {
        boolean hadPending = pending != null;
        pending = null;
        return hadPending;
    }

    void clear() {
        pending = null;
    }
}
