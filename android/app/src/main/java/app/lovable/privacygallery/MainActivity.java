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

    private static final long PERMISSION_DELAY_MS = 500L;
    private static final int MEDIA_PERM_REQUEST_CODE = 4917;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean mediaPermissionsRequested = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Регистрация плагинов Capacitor
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(NativeAdsPlugin.class);
        
        super.onCreate(savedInstanceState);

        applyTransparentStatusBar();

        mainHandler.postDelayed(this::requestMediaPermissions, PERMISSION_DELAY_MS);
    }

    // ── Прозрачный статус-бар ──────────────────────────────────────────────
    private void applyTransparentStatusBar() {
        Window w = getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, true);
        w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.TRANSPARENT);
    }

    // ── Разрешения на медиа ───────────────────────────────────────────────
    private void requestMediaPermissions() {
        if (mediaPermissionsRequested) return;
        mediaPermissionsRequested = true;

        String[] perms;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms = new String[] {
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO
            };
        } else {
            perms = new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
        }

        boolean allGranted = true;
        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(this, p)
                    != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }
        if (allGranted) return;
        ActivityCompat.requestPermissions(this, perms, MEDIA_PERM_REQUEST_CODE);
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
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
