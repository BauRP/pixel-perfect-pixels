package app.lovable.privacygallery;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.content.res.Configuration;
import androidx.core.view.ViewCompat;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import android.util.Log;
import android.view.Window;
import android.view.PixelCopy;
import android.view.WindowManager;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowInsetsCompat;

import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

/**
 * Nova Gallery — native shell. Native AdMob ads respect user consent.
 */
public class MainActivity extends BridgeActivity {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean attemptedLocalBootRecovery = false;
    private volatile boolean galleryUiReady = false;
    private volatile JSObject latestUiLayout;
    private String lastLayoutIssue = "";

    public JSObject getLatestUiLayout() {
        return latestUiLayout;
    }
    private final Runnable localBootRecovery = this::recoverStalledLocalBoot;
    private final Runnable nativeBootFallback = this::showNativeBootFallback;
    private FrameLayout bootRecoveryView;
    private boolean softwarePaintRetryAttempted = false;
    private boolean initialPaintVerified = false;
    private final long bootStartedAt = SystemClock.elapsedRealtime();
    private final Runnable verifyPaint = this::verifyWindowPaint;

    /**
     * PixelCopy samples are transient, never persisted and never transmit
     * pixels. They distinguish actual visible UI from a WebView that claims
     * DOM readiness while the Android GPU compositor is solid black/white.
     */
    private void verifyWindowPaint() {
        // A validly painted launch ends diagnostics permanently for this
        // Activity. NEVER reload a user-opened black photo or video because
        // its pixels resemble a blank startup window.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || isFinishing() || isDestroyed()
                || initialPaintVerified || SystemClock.elapsedRealtime() - bootStartedAt > 45_000L
                || !galleryUiReady || bootRecoveryView != null || !hasWindowFocus()) return;
        View decor = getWindow().getDecorView();
        if (decor.getWidth() < 100 || decor.getHeight() < 100) return;
        final int width = Math.min(360, decor.getWidth());
        final int height = Math.max(100,
                Math.round((float) width * decor.getHeight() / decor.getWidth()));
        Bitmap sample;
        try {
            sample = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        } catch (RuntimeException error) {
            Log.w("NovaGalleryBoot", "Skipping compositor check", error);
            return;
        }
        try {
            PixelCopy.request(getWindow(), sample, result -> {
                try {
                    if (result != PixelCopy.SUCCESS || isFinishing() || isDestroyed()
                            || !galleryUiReady || !hasWindowFocus()) return;
                    if (RenderedSurfaceProbe.hasUiContrast(sample)) {
                        initialPaintVerified = true;
                        Log.i("NovaGalleryBoot", "First gallery compositor frame confirmed");
                        return;
                    }
                    Log.e("NovaGalleryBoot", "Confirmed uniform compositor despite React mount");
                    WebView web = getBridge() == null ? null : getBridge().getWebView();
                    if (web != null && !softwarePaintRetryAttempted) {
                        softwarePaintRetryAttempted = true;
                        galleryUiReady = false;
                        // Switch rendering only after a verified blank frame,
                        // never for normally working gallery/video sessions.
                        web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
                        web.invalidate();
                        web.reload();
                        mainHandler.postDelayed(nativeBootFallback, 18000L);
                        Log.w("NovaGalleryBoot", "One software-compositor retry");
                    } else {
                        // The DOM can say ready while the compositor is still
                        // uniformly blank. Make the native retry available.
                        galleryUiReady = false;
                        showNativeBootFallback();
                    }
                } finally {
                    sample.recycle();
                }
            }, mainHandler);
        } catch (RuntimeException error) {
            sample.recycle();
            Log.w("NovaGalleryBoot", "Unable to sample Android window", error);
        }
    }

    private void schedulePaintVerification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            mainHandler.removeCallbacks(verifyPaint);
            mainHandler.postDelayed(verifyPaint, 2500L);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /**
     * If even inline startup JavaScript/WebView paint cannot execute, render
     * an Android-native recovery screen with an accessible Retry action.
     * Never reload indefinitely, delete application data or require network.
     */
    private void showNativeBootFallback() {
        if (isFinishing() || isDestroyed() || galleryUiReady || bootRecoveryView != null) return;
        FrameLayout container = findViewById(android.R.id.content);
        if (container == null) return;
        FrameLayout overlay = new FrameLayout(this);
        overlay.setTag("nova-native-boot-recovery");
        overlay.setBackgroundColor(Color.rgb(15, 17, 23));
        LinearLayout body = new LinearLayout(this);
        body.setGravity(Gravity.CENTER);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(24), dp(24), dp(24), dp(24));
        TextView title = new TextView(this);
        title.setText("Nova Gallery");
        title.setTextSize(24f);
        title.setGravity(Gravity.CENTER);
        title.setTextColor(Color.WHITE);
        TextView desc = new TextView(this);
        desc.setText("The gallery could not finish displaying. Your photos and Safe are unchanged.");
        desc.setTextSize(16f);
        desc.setGravity(Gravity.CENTER);
        desc.setTextColor(Color.rgb(208, 212, 220));
        desc.setPadding(0, dp(16), 0, dp(20));
        Button retry = new Button(this);
        retry.setText("Retry opening gallery");
        retry.setAllCaps(false);
        retry.setMinHeight(dp(48));
        retry.setOnClickListener(v -> {
            if (isFinishing() || isDestroyed()) return;
            overlay.setVisibility(View.GONE);
            container.removeView(overlay);
            bootRecoveryView = null;
            WebView web = getBridge() == null ? null : getBridge().getWebView();
            if (web != null) {
                web.stopLoading();
                web.reload();
                // Manual retry is bounded; no automatic infinite reload loop.
                mainHandler.postDelayed(nativeBootFallback, 25_000L);
            } else {
                mainHandler.postDelayed(nativeBootFallback, 2000L);
            }
        });
        body.addView(title);
        body.addView(desc);
        body.addView(retry);
        overlay.addView(body, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.setOnApplyWindowInsetsListener(overlay, (view, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.statusBars()
                    | WindowInsetsCompat.Type.navigationBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.captionBar());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });
        container.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bootRecoveryView = overlay;
        ViewCompat.requestApplyInsets(overlay);
        Log.e("NovaGalleryBoot", "Local WebView never rendered; showing native recovery UI");
    }

    /** Called by the SystemInsets plugin after the React gallery shell mounts. */
    public void onGalleryUiReady(JSObject metrics) {
        mainHandler.post(() -> {
            if (isFinishing() || isDestroyed()) return;
            latestUiLayout = metrics;
            String issue = metrics == null
                    ? "MISSING_METRICS" : metrics.optString("layoutIssue", "NO_LAYOUT_VERDICT");
            if (!issue.equals(lastLayoutIssue)) {
                Log.i("NovaGalleryBoot", "React navigation evidence: " + issue);
                lastLayoutIssue = issue;
            }
            // A React effect or a native plugin callback is NOT proof that
            // a safe, visible, tappable gallery was painted. In particular,
            // incomplete/zero-sized navigation must not cancel the watchdog.
            boolean valid = "OK".equals(issue) && metrics != null
                    && metrics.optBoolean("nativeInsetsReady", false)
                    && metrics.optInt("links", 0) == 3;
            if (!valid) return;
            boolean firstMount = !galleryUiReady;
            galleryUiReady = true;
            if (firstMount) Log.i("NovaGalleryBoot", "React gallery UI mounted");
            mainHandler.removeCallbacks(localBootRecovery);
            mainHandler.removeCallbacks(nativeBootFallback);
            if (firstMount) schedulePaintVerification();
            if (bootRecoveryView != null) {
                ViewGroup parent = (ViewGroup) bootRecoveryView.getParent();
                if (parent != null) parent.removeView(bootRecoveryView);
                bootRecoveryView = null;
            }
        });
    }

    // On some API 29/33 WebView provider images, local Capacitor assets can
    // stall at 10% before a single JS callback runs. Recover a stalled LOCAL
    // page once per Activity, never restart an already loaded gallery, and
    // never create a reload loop for a slow network URL.
    private void recoverStalledLocalBoot() {
        if (isFinishing() || isDestroyed() || attemptedLocalBootRecovery || galleryUiReady) return;
        // Permission dialogs, the lock screen and task backgrounding must not
        // trigger a reload of a suspended renderer.
        if (!hasWindowFocus()) {
            mainHandler.postDelayed(localBootRecovery, 8000L);
            return;
        }
        if (getBridge() == null) {
            mainHandler.postDelayed(nativeBootFallback, 12000L);
            return;
        }
        WebView web = getBridge().getWebView();
        if (web == null) {
            attemptedLocalBootRecovery = true;
            mainHandler.postDelayed(nativeBootFallback, 2000L);
            return;
        }
        String url = web.getUrl();
        if (url == null || !(url.startsWith("https://localhost/") ||
                url.startsWith("http://localhost/"))) {
            // Never reload an external URL or an uninitialized WebView. Still
            // provide user-controlled recovery for a failed local bootstrap.
            attemptedLocalBootRecovery = true;
            mainHandler.postDelayed(nativeBootFallback, 2000L);
            return;
        }
        // Android 10/13 CI screenshots proved a blank window even after
        // WebView progress reached 100%. Progress alone is not proof React
        // rendered; only the explicit UI-ready handshake can cancel recovery.
        int progress = web.getProgress();
        attemptedLocalBootRecovery = true;
        Log.w("NovaGalleryBoot", "One-time blank gallery recovery: progress="
                + progress + " url=" + url);
        // On API 29/33 the page sometimes reaches 100% but never paints or
        // sends a single React layout snapshot. Our earlier software-renderer
        // retry lived only in verifyWindowPaint(), which is gated on
        // galleryUiReady, so it was unreachable for precisely these failures.
        // Switch the already-broken local boot to software once, but never
        // change a valid UI, an incomplete network load or a user's media UI.
        if (BootRecoveryPolicy.trySoftwareFallback(
                progress, latestUiLayout != null, softwarePaintRetryAttempted)) {
            softwarePaintRetryAttempted = true;
            web.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            Log.w("NovaGalleryBoot", "Startup software compositor fallback (no React geometry)");
        }
        web.stopLoading();
        web.reload();
        // Only one automatic reload. If the renderer stays blank, native
        // Android controls remain available even with broken JavaScript.
        mainHandler.postDelayed(nativeBootFallback, 20000L);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capacitor 4+ (including 8): ALL local plugins MUST be registered
        // BEFORE BridgeActivity.onCreate constructs its native JS bridge.
        // Otherwise SystemInsets, MediaStore/Safe and NativeAds are unavailable
        // even though Android Java compilation passes.
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(NativeAdsPlugin.class);
        registerPlugin(SystemInsetsPlugin.class);
        super.onCreate(savedInstanceState);

        applyTransparentStatusBar();
        // A stuck blank WebView needs one bounded recovery even at 100% load
        // progress. React's native UI-ready handshake cancels this watchdog.
        mainHandler.postDelayed(localBootRecovery, 25_000L);

        // Media permission is requested by the web layer (SecureVault.requestMediaPermission)
        // right before the first scan, so scanning can never race the dialog.
    }

    // ── Прозрачный статус-бар ──────────────────────────────────────────────
    private void applyTransparentStatusBar() {
        Window w = getWindow();
        // Consistent edge-to-edge coordinates on Android 7 through 17.
        // Java WindowInsetsCompat supplies padding for every actual system bar.
        WindowCompat.setDecorFitsSystemWindows(w, false);
        w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
    }

    // ── Жизненный цикл ────────────────────────────────────────────────────
    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SecureVaultPlugin.DELETE_REQUEST_CODE) {
            SecureVaultPlugin.onDeleteRequestResult(resultCode);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SecureVaultPlugin.MEDIA_PERM_REQUEST_CODE) {
            SecureVaultPlugin.onMediaPermissionResult();
        }
    }

    // OEMs can change 3-button/gesture mode without dispatching an insets event
    // until the next activity resume or rotation. Request an insets pass.
    private void refreshSystemAreas() {
        getWindow().getDecorView().post(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (getBridge() != null && getBridge().getWebView() != null) {
                ViewCompat.requestApplyInsets(getBridge().getWebView());
            } else {
                ViewCompat.requestApplyInsets(getWindow().getDecorView());
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        refreshSystemAreas();
        if (galleryUiReady && !initialPaintVerified) schedulePaintVerification();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        refreshSystemAreas();
        if (galleryUiReady && !initialPaintVerified) schedulePaintVerification();
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        latestUiLayout = null;
        lastLayoutIssue = "";
        bootRecoveryView = null;
        super.onDestroy();
    }
}
