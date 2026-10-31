package app.lovable.privacygallery;

import android.view.View;
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
    private JSObject latest = new JSObject();

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
                Insets gestures = windowInsets.getInsets(WindowInsetsCompat.Type.systemGestures());
                float density = view.getResources().getDisplayMetrics().density;
                if (density <= 0) density = 1f;
                JSObject next = new JSObject();
                next.put("top", Math.ceil(bars.top / density));
                next.put("bottom", Math.ceil(Math.max(bars.bottom, gestures.bottom) / density));
                next.put("left", Math.ceil(Math.max(bars.left, gestures.left) / density));
                next.put("right", Math.ceil(Math.max(bars.right, gestures.right) / density));
                String before = latest.toString();
                latest = next;
                if (!before.equals(next.toString())) {
                    notifyListeners("insetsChanged", next, true);
                }
                return windowInsets; // Never consume the OS insets.
            });
            ViewCompat.requestApplyInsets(webView);
        });
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        call.resolve(latest);
    }
}
