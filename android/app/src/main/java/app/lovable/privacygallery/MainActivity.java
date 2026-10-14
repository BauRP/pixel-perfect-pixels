package app.lovable.privacygallery;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Nova Gallery — native shell. Ad-free.
 */
public class MainActivity extends BridgeActivity {


    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Регистрация плагинов Capacitor
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(NativeAdsPlugin.class);
        
        super.onCreate(savedInstanceState);

        applyTransparentStatusBar();

        // Media permission is requested by the web layer (SecureVault.requestMediaPermission)
        // right before the first scan, so scanning can never race the dialog.
    }

    // ── Прозрачный статус-бар ──────────────────────────────────────────────
    private void applyTransparentStatusBar() {
        Window w = getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, true);
        w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.TRANSPARENT);
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

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
