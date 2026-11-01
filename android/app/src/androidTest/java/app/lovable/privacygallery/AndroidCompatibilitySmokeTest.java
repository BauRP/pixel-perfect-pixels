package app.lovable.privacygallery;

import android.app.Activity;
import android.os.Build;
import android.content.pm.ActivityInfo;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Rule;
import org.junit.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

/**
 * Runs in a real Android emulator, not a simulated JavaScript DOM.
 * Does not access or delete user photos and does not need an AdMob network response.
 */
@RunWith(AndroidJUnit4.class)
public class AndroidCompatibilitySmokeTest {
    @Rule
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
     * Activity start and WebView initialization are asynchronous, especially on
     * Android 10/13 emulator images. A single evaluateJavascript callback may
     * never arrive while the WebView recreates. Poll the LIVE Capacitor WebView
     * on the UI thread, and retry transient "NOT_READY"/callback timeouts.
     * Never classify a timeout as a passed layout test.
     */
    private String awaitWebViewState(String javascript) throws Exception {
        String last = "NOT_READY";
        for (int attempt = 0; attempt < 32; attempt++) {
            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> result = new AtomicReference<>("");
            scenario.getScenario().onActivity(activity -> {
                WebView web = activity.getBridge() == null
                        ? null : activity.getBridge().getWebView();
                if (web == null || !web.isAttachedToWindow()) {
                    result.set("\"NOT_READY\"");
                    latch.countDown();
                    return;
                }
                try {
                    web.evaluateJavascript(javascript, value -> {
                        result.set(value == null ? "null" : value);
                        latch.countDown();
                    });
                } catch (RuntimeException error) {
                    result.set("\"WEBVIEW_REPLACED\"");
                    latch.countDown();
                }
            });
            if (!latch.await(3, TimeUnit.SECONDS)) {
                last = "CALLBACK_TIMEOUT";
            } else {
                last = result.get();
                if (!"\"NOT_READY\"".equals(last) &&
                        !"\"WEBVIEW_REPLACED\"".equals(last) &&
                        !"null".equals(last) && !last.isEmpty()) {
                    return last;
                }
            }
            Thread.sleep(350);
        }
        return last;
    }

    private String webViewDiagnostic() throws Exception {
        String js = "(function(){try{return JSON.stringify({" +
                "url:location.href,ready:document.readyState," +
                "userAgent:navigator.userAgent,title:document.title," +
                "bodyText:(document.body&&document.body.innerText||'').slice(0,320)," +
                "hasNav:!!document.querySelector('[data-bottom-nav]')," +
                "hasShell:!!document.querySelector('[data-app-shell]')," +
                "scriptCount:document.scripts.length," +
                "insetsReady:document.documentElement.dataset.novaInsetsReady||'unknown'," +
                "hasError:!!document.querySelector('[data-nova-error]')" +
                "});}catch(e){return 'DIAG_ERROR:'+e.message}})()";
        return awaitWebViewState(js);
    }

    @Test
    public void webAppSafeAreaVariablesAndNavigationRender() throws Exception {
        String state = awaitWebViewState(
            "(function(){var root=document.documentElement;" +
            "var n=document.querySelector('[data-bottom-nav]');" +
            "if(!n)return 'NOT_READY';" +
            "var s=getComputedStyle(root);" +
            "if(!s.getPropertyValue('--app-safe-top').trim()||" +
            "!s.getPropertyValue('--app-safe-bottom').trim())return 'MISSING_INSETS';" +
            "var box=n.getBoundingClientRect();" +
            "if(box.width<=0||box.height<=0)return 'BAD_NAV_SIZE';" +
            "if(box.bottom>innerHeight+3)return 'NAV_OUTSIDE_WINDOW';" +
            "return 'OK';})()"
        );
        String details = "\"OK\"".equals(state) ? "" : webViewDiagnostic();
        assertEquals("Android API " + Build.VERSION.SDK_INT +
                " navigation/state " + state + "; WebView " + details,
                "\"OK\"", state);
    }

    @Test
    public void screenshotSafeAreaAndBottomNavigationArePresent() throws Exception {
        String state = awaitWebViewState(
            "(function(){var n=document.querySelector('[data-bottom-nav]');" +
            "var shell=document.querySelector('[data-app-shell]');" +
            "var content=document.querySelector('[data-app-content]');" +
            "if(!n||!shell||!content)return 'NOT_READY';" +
            "var nav=n.getBoundingClientRect(),body=content.getBoundingClientRect();" +
            "if(nav.bottom>innerHeight+3||nav.width<=0)return 'NAV_OVERFLOW';" +
            "var safe=parseFloat(getComputedStyle(document.documentElement)" +
            ".getPropertyValue('--native-safe-top'))||0;" +
            "if(body.top<safe-3)return 'STATUS_BAR_OVERLAP';" +
            "if(!document.documentElement.dataset.novaInsetsReady)return 'NO_NATIVE_INSETS';" +
            "return 'OK';})()"
        );
        String details = "\"OK\"".equals(state) ? "" : webViewDiagnostic();
        assertEquals("Android API " + Build.VERSION.SDK_INT +
                " window-safe-area test: " + details, "\"OK\"", state);
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
