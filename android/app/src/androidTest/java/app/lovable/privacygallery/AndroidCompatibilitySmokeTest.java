package app.lovable.privacygallery;

import android.app.Activity;
import android.os.Build;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.SystemClock;
import android.content.pm.ActivityInfo;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.view.Gravity;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.rule.GrantPermissionRule;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

/**
 * Runs in a real Android emulator, not a simulated JavaScript DOM.
 * Does not access or delete user photos and does not need an AdMob network response.
 */
@RunWith(AndroidJUnit4.class)
public class AndroidCompatibilitySmokeTest {
    // Request gallery permissions before the ActivityScenario launches.
    // Otherwise Android 10/13 may display a runtime permission sheet while
    // evaluateJavascript awaits a paused/inactive WebView, causing false
    // CALLBACK_TIMEOUT failures that look like a layout regression.
    @Rule(order = 0)
    public GrantPermissionRule mediaPermissions = Build.VERSION.SDK_INT >= 33
            ? GrantPermissionRule.grant(
                    "android.permission.READ_MEDIA_IMAGES",
                    "android.permission.READ_MEDIA_VIDEO")
            : GrantPermissionRule.grant("android.permission.READ_EXTERNAL_STORAGE");

    @Rule(order = 1)
    public ActivityScenarioRule<MainActivity> scenario =
            new ActivityScenarioRule<>(MainActivity.class);

    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int i = 0; i < parent.getChildCount(); i++) {
                WebView found = findWebView(parent.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    /**
     * A control WebView with no React, router, Capacitor or media access is
     * loaded inside the SAME disposable emulator Activity. If its independent
     * evaluateJavascript callback also stalls, the provider/renderer is not
     * generally responding. If the control works while Nova's gallery fails,
     * investigate the app-side JS/layout path rather than assuming a broken
     * emulator GPU. This test never replaces the actual gallery smoke test.
     */
    @Test
    public void isolatedControlWebViewExecutesSimpleJavaScript() throws Exception {
        final CountDownLatch received = new CountDownLatch(1);
        final AtomicReference<String> response = new AtomicReference<>("");
        final AtomicReference<WebView> controlRef = new AtomicReference<>();
        scenario.getScenario().onActivity(activity -> {
            FrameLayout parent = activity.findViewById(android.R.id.content);
            WebView control = new WebView(activity);
            controlRef.set(control);
            control.getSettings().setJavaScriptEnabled(true);
            control.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    view.evaluateJavascript("(function(){return 6*7})()", value -> {
                        response.set(value == null ? "" : value);
                        received.countDown();
                    });
                }
            });
            parent.addView(control, new FrameLayout.LayoutParams(
                    96, 96, Gravity.TOP | Gravity.LEFT));
            control.loadDataWithBaseURL("https://localhost/",
                    "<!doctype html><html><body>Nova control</body></html>",
                    "text/html", "UTF-8", null);
        });
        boolean finished = received.await(12, TimeUnit.SECONDS);
        // Remove the isolated WebView regardless of outcome. No app state,
        // photo, ads, credentials or protected media are accessed here.
        scenario.getScenario().onActivity(activity -> {
            WebView control = controlRef.get();
            if (control != null) {
                control.stopLoading();
                if (control.getParent() instanceof android.view.ViewGroup) {
                    ((android.view.ViewGroup) control.getParent()).removeView(control);
                }
                control.destroy();
            }
        });
        assertTrue("Independent WebView did not respond to basic JS", finished);
        assertEquals("Independent WebView computed unexpected JS result", "42", response.get());
    }

    @Test
    public void rendererHealthObserverOnlyTargetsProblematicEmulators() {
        assertTrue(BootRecoveryPolicy.observeLegacyRendererOnEmulator(29, true));
        assertTrue(BootRecoveryPolicy.observeLegacyRendererOnEmulator(33, true));
        for (int sdk : new int[]{24, 26, 28, 30, 31, 32, 34, 35, 36, 37}) {
            assertFalse(BootRecoveryPolicy.observeLegacyRendererOnEmulator(sdk, true));
        }
        assertFalse(BootRecoveryPolicy.observeLegacyRendererOnEmulator(29, false));
        assertFalse(BootRecoveryPolicy.observeLegacyRendererOnEmulator(33, false));
    }

    @Test
    public void softwareFallbackIsOnlyForUnresponsiveLocalStartup() {
        assertTrue(BootRecoveryPolicy.trySoftwareFallback(100, false, false));
        assertTrue(BootRecoveryPolicy.trySoftwareFallback(90, false, false));
        assertFalse(BootRecoveryPolicy.trySoftwareFallback(89, false, false));
        // A diagnostic-only React snapshot must NOT suppress a recovery.
        // The caller passes true only for validated three-tab geometry.
        assertFalse(BootRecoveryPolicy.trySoftwareFallback(100, true, false));
        assertFalse(BootRecoveryPolicy.trySoftwareFallback(100, false, true));
    }

    @Test
    public void compositorProbeRejectsSolidBlackAndWhiteWindows() {
        Bitmap bitmap = Bitmap.createBitmap(320, 600, Bitmap.Config.ARGB_8888);
        try {
            bitmap.eraseColor(Color.BLACK);
            assertFalse(RenderedSurfaceProbe.hasUiContrast(bitmap));
            bitmap.eraseColor(Color.WHITE);
            assertFalse(RenderedSurfaceProbe.hasUiContrast(bitmap));
            // OS-level controls alone are not proof of rendered gallery UI.
            Paint p = new Paint();
            p.setColor(Color.BLACK);
            Canvas c = new Canvas(bitmap);
            c.drawRect(0, 580, 320, 600, p);
            assertFalse(RenderedSurfaceProbe.hasUiContrast(bitmap));
        } finally {
            bitmap.recycle();
        }
    }

    @Test
    public void compositorProbeAcceptsDarkAndLightGalleryControls() {
        Bitmap bitmap = Bitmap.createBitmap(320, 600, Bitmap.Config.ARGB_8888);
        try {
            Canvas c = new Canvas(bitmap);
            Paint p = new Paint();
            bitmap.eraseColor(Color.rgb(14, 15, 20));
            p.setColor(Color.WHITE);
            c.drawRect(30, 60, 290, 88, p);
            c.drawRect(40, 500, 270, 530, p);
            assertTrue(RenderedSurfaceProbe.hasUiContrast(bitmap));
            bitmap.eraseColor(Color.WHITE);
            p.setColor(Color.BLACK);
            c.drawRect(30, 60, 290, 88, p);
            c.drawRect(40, 500, 270, 530, p);
            assertTrue(RenderedSurfaceProbe.hasUiContrast(bitmap));
        } finally {
            bitmap.recycle();
        }
    }

    @Test
    public void noFullscreenFlagsCanCoverStatusOrNavigationBars() {
        scenario.getScenario().onActivity(activity -> {
            int flags = activity.getWindow().getAttributes().flags;
            assertEquals("System status bar must remain visible",
                    0, flags & WindowManager.LayoutParams.FLAG_FULLSCREEN);
            assertEquals("Application must not draw outside window boundaries",
                    0, flags & WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
            assertNotNull("Native WebView must exist",
                    findWebView(activity.getWindow().getDecorView()));
        });
    }

    @Test
    public void nativeWindowInsetsAreAccessibleAndNonNegative() {
        scenario.getScenario().onActivity(activity -> {
            View decor = activity.getWindow().getDecorView();
            WindowInsetsCompat current = ViewCompat.getRootWindowInsets(decor);
            // Initial insets can be briefly null before first frame; the
            // activity must still have a real attached content window.
            assertNotNull("Android decor view must be attached", decor.getWindowToken());
            if (current == null) return;
            Insets bars = current.getInsets(
                WindowInsetsCompat.Type.statusBars()
                | WindowInsetsCompat.Type.navigationBars()
                | WindowInsetsCompat.Type.displayCutout()
                | WindowInsetsCompat.Type.captionBar());
            assertTrue(bars.top >= 0 && bars.bottom >= 0);
            assertTrue(bars.left >= 0 && bars.right >= 0);
        });
    }

    /**
     * Read actual measured React layout over Capacitor's existing native
     * bridge. This does not rely on evaluateJavascript() callbacks, which can
     * hang on Android 10/13. Missing UI MUST fail, never pass heuristically.
     */
    private com.getcapacitor.JSObject awaitNativeLayout() throws Exception {
        java.util.concurrent.atomic.AtomicReference<com.getcapacitor.JSObject> state =
                new java.util.concurrent.atomic.AtomicReference<>();
        long deadline = SystemClock.elapsedRealtime() + 52_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            scenario.getScenario().onActivity(activity -> state.set(activity.getLatestUiLayout()));
            com.getcapacitor.JSObject layout = state.get();
            if (layout != null && layout.optBoolean("nativeInsetsReady", false)) return layout;
            SystemClock.sleep(450L);
        }
        fail("Android API " + Build.VERSION.SDK_INT +
                " did not report validated React navigation and native insets: " +
                (state.get() == null ? "NO_REACT_SHELL" : state.get().toString()));
        throw new AssertionError("unreachable");
    }

    @Test
    public void webAppSafeAreaVariablesAndNavigationRender() throws Exception {
        com.getcapacitor.JSObject ui = awaitNativeLayout();
        double width = ui.optDouble("viewportWidth", -1);
        double height = ui.optDouble("viewportHeight", -1);
        assertTrue("WebView viewport not measured: " + ui, width > 100 && height > 100);
        assertTrue("Bottom navigation not visible: " + ui,
                ui.optDouble("navWidth", -1) > 0 &&
                ui.optDouble("navHeight", -1) >= 36);
        assertTrue("Bottom bar outside viewport: " + ui,
                ui.optDouble("navBottom", 10000) <= height + 3);
        assertTrue("Insets not measured: " + ui, ui.optBoolean("nativeInsetsReady", false));
        assertEquals("Gallery DOM geometry must satisfy the shared contract: " + ui,
                "OK", ui.optString("layoutIssue", "NO_GEOMETRY_VERDICT"));
    }

    @Test
    public void screenshotSafeAreaAndBottomNavigationArePresent() throws Exception {
        com.getcapacitor.JSObject ui = awaitNativeLayout();
        assertTrue("Content overlaps Android status/cutout: " + ui,
                ui.optDouble("contentTop", -100) >= ui.optDouble("safeTop", 10000) - 3);
        assertTrue("Navigation outside screen: " + ui,
                ui.optDouble("navBottom", 10000) <= ui.optDouble("viewportHeight", 0) + 3);
    }

    @Test
    public void bottomNavigationHitTargetsStayAboveSystemControls() throws Exception {
        com.getcapacitor.JSObject ui = awaitNativeLayout();
        assertFalse("Bottom tabs hidden by IME: " + ui, ui.optBoolean("imeOpen", true));
        assertEquals("Require all 3 tabs: " + ui, 3, ui.optInt("links", -1));
        assertTrue("Tab targets below 40px: " + ui,
                ui.optDouble("minLinkHeight", 0) >= 48 &&
                ui.optDouble("minLinkWidth", 0) > 0);
        assertTrue("Tab overlaps system bar: " + ui,
                ui.optDouble("maxLinkBottom", 10000) <=
                ui.optDouble("navInnerBottom", -1000) + 3);
        assertTrue("Tab overlaps side cutout: " + ui,
                ui.optDouble("minLinkLeft", -1000) >= ui.optDouble("navInnerLeft", 1000) - 3 &&
                ui.optDouble("maxLinkRight", 1000) <= ui.optDouble("navInnerRight", -1000) + 3);
    }

    @Test
    public void statusAndNavigationInsetsRemainWithinDisplayBounds() {
        scenario.getScenario().onActivity(activity -> {
            View root = activity.getWindow().getDecorView();
            WindowInsetsCompat current = ViewCompat.getRootWindowInsets(root);
            if (current == null) return;
            Insets bars = current.getInsets(
                WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout()
                | WindowInsetsCompat.Type.captionBar());
            assertTrue("Top OS bar cannot exceed display", bars.top <= root.getHeight());
            assertTrue("Bottom OS bar cannot exceed display", bars.bottom <= root.getHeight());
            assertTrue("Side bars cannot exceed display", bars.left <= root.getWidth());
            assertTrue("Side bars cannot exceed display", bars.right <= root.getWidth());
        });
    }

    @Test
    public void activityDoesNotLockOrientationOrResizing() {
        scenario.getScenario().onActivity(activity -> {
            assertEquals("Must allow portrait, landscape and foldable changes",
                    ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED,
                    activity.getRequestedOrientation());
            assertTrue("The WebView must have a valid parent",
                    findWebView(activity.getWindow().getDecorView()).getParent() != null);
        });
    }
}
