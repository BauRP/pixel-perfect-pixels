package app.lovable.privacygallery;

import android.app.Activity;
import android.webkit.WebView;
import android.view.View;
import android.os.Build;
import android.graphics.Color;
import androidx.core.view.WindowCompat;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports actual OS system bar and cutout insets to the WebView.
 * Android 7+; responds to gesture/three-button navigation changes,
 * display cutouts, rotations and multi-window resizing automatically.
 */
@CapacitorPlugin(name = "SystemInsets")
public class SystemInsetsPlugin extends Plugin {
    private volatile JSObject latest = new JSObject();

    /** One consistent snapshot for changes and for the first JS request. */
    private JSObject snapshot(View view, WindowInsetsCompat windowInsets) {
        Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.statusBars()
                | WindowInsetsCompat.Type.navigationBars()
                | WindowInsetsCompat.Type.displayCutout()
                | WindowInsetsCompat.Type.captionBar());
        Insets mandatory = windowInsets.getInsets(
                WindowInsetsCompat.Type.mandatorySystemGestures());
        Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
        float density = view.getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        JSObject result = new JSObject();
        result.put("top", Math.ceil(bars.top / density));
        result.put("bottom", Math.ceil(Math.max(bars.bottom, mandatory.bottom) / density));
        result.put("left", Math.ceil(bars.left / density));
        result.put("right", Math.ceil(bars.right / density));
        // Do not mistake a transient IME visibility flag for an actual
        // keyboard covering the app's bottom navigation controls.
        final int thresholdPx = Math.round(48f * density);
        boolean keyboardOverlapsBottom =
                windowInsets.isVisible(WindowInsetsCompat.Type.ime())
                && ime.bottom > Math.max(bars.bottom, mandatory.bottom) + thresholdPx;
        result.put("keyboardVisible", keyboardOverlapsBottom);
        // A numeric zero is NOT proof that Android actually measured 0px
        // bars. The JS shell must not mark its safe-area ready until a real
        // WindowInsetsCompat instance has been observed.
        result.put("measured", true);
        return result;
    }

    private void publish(JSObject next) {
        String before = latest.toString();
        latest = next;
        if (before.equals(next.toString())) return;
        // Activity recreation can deliver one final WindowInsets callback
        // after the old Capacitor JavaScript bridge has been detached.
        // The old listener then throws "triggerEvent of undefined" and
        // cannot be allowed to re-enter a destroyed WebView.
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()
                || getBridge() == null || getBridge().getWebView() == null
                || !getBridge().getWebView().isAttachedToWindow()) return;
        notifyListeners("insetsChanged", next, true);
    }

    @Override
    public void load() {
        super.load();
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed() || getBridge() == null) return;
            final WebView webView = getBridge().getWebView();
            if (webView == null) return;
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
                publish(snapshot(view, insets));
                return insets; // Never consume system insets.
            });
            // The native WebView may attach after the plugin has loaded.
            webView.post(() -> ViewCompat.requestApplyInsets(webView));
        });
    }

    /**
     * Contrast-correct native status/nav bar icons on both light and dark themes.
     * Android 7 has no dark navigation icons: use a dark nav-bar background there.
     */
    @PluginMethod
    public void setSystemBarAppearance(PluginCall call) {
        final boolean light = call.getBoolean("lightBackground", false);
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Activity is no longer active");
            return;
        }
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Activity was destroyed before system bars could change");
                return;
            }
            WindowCompat.getInsetsController(activity.getWindow(),
                    activity.getWindow().getDecorView())
                .setAppearanceLightStatusBars(light);
            WindowCompat.getInsetsController(activity.getWindow(),
                    activity.getWindow().getDecorView())
                .setAppearanceLightNavigationBars(light);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && light) {
                activity.getWindow().setNavigationBarColor(Color.BLACK);
            } else {
                activity.getWindow().setNavigationBarColor(Color.TRANSPARENT);
            }
            call.resolve();
        });
    }

    /**
     * UI-only readiness handshake. Native progress=100 does not guarantee
     * that React rendered (observed on Android 10/13 emulator WebViews).
     * A genuine AppShell mount is the sole condition for cancelling the
     * one-time native boot watchdog.
     */
    @PluginMethod
    public void signalUiReady(PluginCall call) {
        final Activity activity = getActivity();
        if (!(activity instanceof MainActivity) || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Gallery activity is not available");
            return;
        }
        ((MainActivity) activity).onGalleryUiReady(call.getData());
        call.resolve();
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        // JS may request insets before an onApplyWindowInsets event arrives.
        // Obtain a fresh root snapshot on the UI thread, and keep the
        // subscription for later changes (rotation/buttons/gestures/keyboard).
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Activity is no longer active");
            return;
        }
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Activity was destroyed before reading insets");
                return;
            }
            WebView web = getBridge() == null ? null : getBridge().getWebView();
            View source = web != null ? web : activity.getWindow().getDecorView();
            WindowInsetsCompat current = ViewCompat.getRootWindowInsets(source);
            if (current == null && web != null) {
                // Early startup: the decor view can already have insets
                // before the child WebView is attached.
                source = activity.getWindow().getDecorView();
                current = ViewCompat.getRootWindowInsets(source);
            }
            if (current != null) {
                // A read MUST NOT emit an "insetsChanged" event back to JS:
                // the listener then remeasures the frame and asks getInsets
                // again, creating a feedback loop during startup/rotation.
                // Real OS WindowInsets events continue through publish() in
                // onApplyWindowInsets, so gesture/3-button/IME updates remain.
                JSObject measured = snapshot(source, current);
                latest = measured;
                call.resolve(measured);
                return;
            }
            // Empty snapshot is NOT proof that system bars are zero.
            ViewCompat.requestApplyInsets(source);
            JSObject pending = new JSObject();
            pending.put("measured", false);
            call.resolve(pending);
        });
    }
}
