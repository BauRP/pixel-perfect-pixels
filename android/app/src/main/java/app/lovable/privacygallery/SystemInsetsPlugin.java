package app.lovable.privacygallery;

import android.webkit.WebView;

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

    @Override
    public void load() {
        super.load();
        getActivity().runOnUiThread(() -> {
            final WebView webView = getBridge().getWebView();
            if (webView == null) return;
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                        WindowInsetsCompat.Type.statusBars()
                        | WindowInsetsCompat.Type.navigationBars()
                        | WindowInsetsCompat.Type.displayCutout());
                // Include the gesture touch region even when the gesture bar is translucent.
                // Side-swipe gestures should NOT create blank left/right columns.
                // Reserve only the actual bar/cutout, plus mandatory bottom gestures.
                Insets mandatory = windowInsets.getInsets(
                        WindowInsetsCompat.Type.mandatorySystemGestures());
                boolean keyboardVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
                float density = view.getResources().getDisplayMetrics().density;
                if (density <= 0) density = 1f;
                JSObject next = new JSObject();
                next.put("top", Math.ceil(bars.top / density));
                next.put("bottom", Math.ceil(Math.max(bars.bottom, mandatory.bottom) / density));
                next.put("left", Math.ceil(bars.left / density));
                next.put("right", Math.ceil(bars.right / density));
                next.put("keyboardVisible", keyboardVisible);
                String before = latest.toString();
                latest = next;
                if (!before.equals(next.toString())) {
                    notifyListeners("insetsChanged", next, true);
                }
                return windowInsets; // Never consume the OS insets.
            });
            // The native WebView may attach after the plugin has loaded.
            webView.post(() -> ViewCompat.requestApplyInsets(webView));
        });
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        call.resolve(latest);
    }
}
