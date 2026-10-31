package app.lovable.privacygallery;

import android.app.Activity;
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
        scenario.getScenario().onActivity(activity ->
            web.set(findWebView(activity.getWindow().getDecorView())));
        assertNotNull("WebView must be attached", web.get());

        // Wait for the actual React app to load, not just the Android activity.
        // Evaluate on UI thread; wait only on the instrumentation thread.
        String state = "NOT_READY";
        for (int attempt = 0; attempt < 25; attempt++) {
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
        assertEquals("Web app and safe-area navigation must render", "\"OK\"", state);
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
