package app.lovable.privacygallery;

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
        float density = view.getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        JSObject result = new JSObject();
        result.put("top", Math.ceil(bars.top / density));
        result.put("bottom", Math.ceil(Math.max(bars.bottom, mandatory.bottom) / density));
        result.put("left", Math.ceil(bars.left / density));
        result.put("right", Math.ceil(bars.right / density));
        result.put("keyboardVisible",
                windowInsets.isVisible(WindowInsetsCompat.Type.ime()));
        return result;
    }

    private void publish(JSObject next) {
        String before = latest.toString();
        latest = next;
        if (!before.equals(next.toString())) {
            notifyListeners("insetsChanged", next, true);
        }
    }

    @Override
    public void load() {
        super.load();
        getActivity().runOnUiThread(() -> {
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
        getActivity().runOnUiThread(() -> {
            WindowCompat.getInsetsController(getActivity().getWindow(),
                    getActivity().getWindow().getDecorView())
                .setAppearanceLightStatusBars(light);
            WindowCompat.getInsetsController(getActivity().getWindow(),
                    getActivity().getWindow().getDecorView())
                .setAppearanceLightNavigationBars(light);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && light) {
                getActivity().getWindow().setNavigationBarColor(Color.BLACK);
            } else {
                getActivity().getWindow().setNavigationBarColor(Color.TRANSPARENT);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        // JS may request insets before an onApplyWindowInsets event arrives.
        // Obtain a fresh root snapshot on the UI thread, and keep the
        // subscription for later changes (rotation/buttons/gestures/keyboard).
        getActivity().runOnUiThread(() -> {
            WebView web = getBridge() == null ? null : getBridge().getWebView();
            View source = web != null ? web : getActivity().getWindow().getDecorView();
            WindowInsetsCompat current = ViewCompat.getRootWindowInsets(source);
            if (current == null && web != null) {
                // Early startup: the decor view can already have insets
                // before the child WebView is attached.
                source = getActivity().getWindow().getDecorView();
                current = ViewCompat.getRootWindowInsets(source);
            }
            if (current != null) {
                publish(snapshot(source, current));
            } else {
                // Empty snapshot is NOT proof that all system bars are zero.
                // Ask Android to dispatch an actual snapshot when attached.
                ViewCompat.requestApplyInsets(source);
            }
            call.resolve(latest);
        });
    }
}
