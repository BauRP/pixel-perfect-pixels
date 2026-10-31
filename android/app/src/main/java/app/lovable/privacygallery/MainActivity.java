package app.lovable.privacygallery;

import android.content.Intent;
import android.graphics.Color;
import android.content.res.Configuration;
import androidx.core.view.ViewCompat;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Nova Gallery — native shell. Ad-free.
 */
public class MainActivity extends BridgeActivity {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Регистрация плагинов Capacitor (обязательно ПОСЛЕ super.onCreate)
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(NativeAdsPlugin.class);
        registerPlugin(SystemInsetsPlugin.class);

        applyTransparentStatusBar();

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
        getWindow().getDecorView().post(() ->
                ViewCompat.requestApplyInsets(getWindow().getDecorView()));
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
