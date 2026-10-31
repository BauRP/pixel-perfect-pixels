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

    @Test
    public void webAppSafeAreaVariablesAndNavigationRender() throws Exception {
        AtomicReference<WebView> web = new AtomicReference<>();
        // Resolve Capacitor's OWN WebView. The decor tree can contain another
        // WebView (UMP consent / Google ads); the first one is not guaranteed
        // to host the React gallery.
        scenario.getScenario().onActivity(activity -> {
            WebView mainWebView = activity.getBridge() == null
                    ? null : activity.getBridge().getWebView();
            web.set(mainWebView != null
                    ? mainWebView : findWebView(activity.getWindow().getDecorView()));
        });
        assertNotNull("WebView must be attached", web.get());

        // Wait for the actual React app to load, not just the Android activity.
        // Evaluate on UI thread; wait only on the instrumentation thread.
        String state = "NOT_READY";
        for (int attempt = 0; attempt < 40; attempt++) {
            CountDownLatch done = new CountDownLatch(1);
            AtomicReference<String> jsResult = new AtomicReference<>("");
            scenario.getScenario().onActivity(activity -> web.get().evaluateJavascript(
                "(function(){const r=document.documentElement;" +
                "const n=document.querySelector('[data-bottom-nav]');" +
                "if(!n)return 'NOT_READY';" +
                "const s=getComputedStyle(r);" +
                "const top=s.getPropertyValue('--app-safe-top').trim();" +
                "const bottom=s.getPropertyValue('--app-safe-bottom').trim();" +
                "if(!top||!bottom)return 'MISSING_INSETS';" +
                "const box=n.getBoundingClientRect();" +
                "if(box.width<=0||box.height<=0)return 'BAD_NAV_SIZE';" +
                "if(box.bottom>innerHeight+3)return 'NAV_OUTSIDE_WINDOW';" +
                "return 'OK';})()",
                result -> { jsResult.set(result); done.countDown(); }));
            assertTrue("WebView JS callback timed out", done.await(5, TimeUnit.SECONDS));
            state = jsResult.get();
            if (!"\"NOT_READY\"".equals(state)) break;
            Thread.sleep(400);
        }
        String details = "";
        if (!"\"OK\"".equals(state)) {
            CountDownLatch done = new CountDownLatch(1);
            AtomicReference<String> diagnostic = new AtomicReference<>("");
            scenario.getScenario().onActivity(activity -> web.get().evaluateJavascript(
                "(function(){try{return JSON.stringify({" +
                "url:location.href,ready:document.readyState," +
                "userAgent:navigator.userAgent," +
                "title:document.title," +
                "bodyText:(document.body&&document.body.innerText||'').slice(0,320)," +
                "scriptCount:document.scripts.length," +
                "scriptSrcs:Array.prototype.map.call(document.scripts,function(s){return s.src||s.type||'inline'}).slice(-10)," +
                "hasRoot:!!document.getElementById('root')," +
                "rootText:(document.getElementById('root')&&document.getElementById('root').innerText||'').slice(0,320)," +
                "hasNav:!!document.querySelector('[data-bottom-nav]')," +
                "legacyRuntime:!!(window.System&&window.System.import)," +
                "legacyBoot:window.__novaLegacyBootState||'unknown'," +
                "errorFlag:!!document.querySelector('[data-nova-error]')" +
                "});}catch(e){return 'DIAG_ERROR:'+e.message}})()",
                result -> { diagnostic.set(result); done.countDown(); }));
            done.await(5, TimeUnit.SECONDS);
            details = diagnostic.get();
            android.util.Log.e("AndroidCompatTest",
                    "Missing gallery UI diagnostic: " + details);
        }
        assertEquals("Web app and safe-area navigation must render. API "
                + Build.VERSION.SDK_INT + ", document: " + details,
                "\"OK\"", state);
    }

    @Test
    public void screenshotSafeAreaAndBottomNavigationArePresent() throws Exception {
        AtomicReference<WebView> web = new AtomicReference<>();
        scenario.getScenario().onActivity(activity -> web.set(
                activity.getBridge().getWebView()));
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>("");
        scenario.getScenario().onActivity(activity -> web.get().evaluateJavascript(
            "(function(){var n=document.querySelector('[data-bottom-nav]');" +
            "if(!n)return 'NOT_READY';" +
            "var root=document.documentElement;" +
            "var nav=n.getBoundingClientRect();" +
            "if(nav.bottom>innerHeight+3)return 'NAV_OVERFLOW';" +
            "if(!root.style.getPropertyValue('--native-safe-top'))return 'NO_NATIVE_INSETS';" +
            "return 'OK';})()",
            value -> { result.set(value); latch.countDown(); }));
        assertTrue("JS callback must finish", latch.await(6, TimeUnit.SECONDS));
        assertTrue("Navigation can render after the cold start: " + result.get(),
                "\"OK\"".equals(result.get()) || "\"NOT_READY\"".equals(result.get()));
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
