package app.lovable.privacygallery;

import android.content.Intent;
import android.graphics.Color;
import android.content.res.Configuration;
import androidx.core.view.ViewCompat;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Nova Gallery — native shell. Native AdMob ads respect user consent.
 */
public class MainActivity extends BridgeActivity {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean attemptedLocalBootRecovery = false;
    private volatile boolean galleryUiReady = false;
    private final Runnable localBootRecovery = this::recoverStalledLocalBoot;

    /** Called by the SystemInsets plugin after the React gallery shell mounts. */
    public void onGalleryUiReady() {
        galleryUiReady = true;
        Log.i("NovaGalleryBoot", "React gallery UI mounted");
        mainHandler.removeCallbacks(localBootRecovery);
    }

    // On some API 29/33 WebView provider images, local Capacitor assets can
    // stall at 10% before a single JS callback runs. Recover a stalled LOCAL
    // page once per Activity, never restart an already loaded gallery, and
    // never create a reload loop for a slow network URL.
    private void recoverStalledLocalBoot() {
        if (isFinishing() || isDestroyed() || attemptedLocalBootRecovery
                || galleryUiReady || getBridge() == null) return;
        WebView web = getBridge().getWebView();
        if (web == null) return;
        String url = web.getUrl();
        if (url == null || !(url.startsWith("https://localhost/") ||
                url.startsWith("http://localhost/"))) return;
        // Android 10/13 CI screenshots proved a blank window even after
        // WebView progress reached 100%. Progress alone is not proof React
        // rendered; only the explicit UI-ready handshake can cancel recovery.
        int progress = web.getProgress();
        attemptedLocalBootRecovery = true;
        Log.w("NovaGalleryBoot", "One-time blank gallery recovery: progress="
                + progress + " url=" + url);
        web.stopLoading();
        web.reload();
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
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        refreshSystemAreas();
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
