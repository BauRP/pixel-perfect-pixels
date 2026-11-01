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
import androidx.test.rule.GrantPermissionRule;

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
        for (int attempt = 0; attempt < 24; attempt++) {
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
            if (!latch.await(4, TimeUnit.SECONDS)) {
                last = "CALLBACK_TIMEOUT";
                // Keep the WebView state in diagnostics rather than claiming
                // a blank screen is an Android layout failure.
                scenario.getScenario().onActivity(activity -> {
                    WebView web = activity.getBridge() == null
                            ? null : activity.getBridge().getWebView();
                    if (web != null) {
                        android.util.Log.w("AndroidCompatTest",
                                "WebView JS callback timeout: URL=" + web.getUrl()
                                + " progress=" + web.getProgress()
                                + " attached=" + web.isAttachedToWindow()
                                + " visible=" + web.getVisibility());
                    }
                });
            } else {
                last = result.get();
                if (!"\"NOT_READY\"".equals(last) &&
                        !"\"WEBVIEW_REPLACED\"".equals(last) &&
                        !"\"NO_NATIVE_INSETS\"".equals(last) &&
                        !"\"MISSING_INSETS\"".equals(last) &&
                        !last.startsWith("\"TABS_HIDDEN_IME_") &&
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

    /**
     * A fixed bottom bar can fit the viewport while its actual tab hit
     * targets still overlap Android's gesture strip or three-button region.
     * Measure rendered CSS geometry, not a guessed navigation mode.
     */
    @Test
    public void bottomNavigationHitTargetsStayAboveSystemControls() throws Exception {
        String state = awaitWebViewState(
            "(function(){var root=document.documentElement;" +
            "var nav=document.querySelector('[data-bottom-nav]');" +
            "if(!nav)return 'NOT_READY';" +
            "var links=nav.querySelectorAll('a');" +
            "if(links.length!==3)return 'MISSING_TABS';" +
            "var b=nav.getBoundingClientRect();" +
            "if(getComputedStyle(nav).display==='none')" +
            "return 'TABS_HIDDEN_IME_'+(root.dataset.imeOpen||'unknown');" +
            "var css=getComputedStyle(nav);" +
            "var paddingBottom=parseFloat(css.paddingBottom)||0;" +
            "var leftPadding=parseFloat(css.paddingLeft)||0;" +
            "var rightPadding=parseFloat(css.paddingRight)||0;" +
            "var minY=b.bottom-paddingBottom;" +
            "if(links[0].tagName!=='A')return 'WRONG_LINK_ELEMENT';" +
            "for(var i=0;i<links.length;i++){" +
            "var r=links[i].getBoundingClientRect();" +
            "if(r.width<=0||r.height<40)return 'TINY_TAB_'+i+" +
            "'_'+Math.round(r.width)+'x'+Math.round(r.height);" +
            "if(r.bottom>minY+3)return 'TAB_OVERLAPS_SYSTEM_BAR';" +
            "if(r.left<b.left+leftPadding-3||r.right>b.right-rightPadding+3)" +
            "return 'TAB_OVERLAPS_SIDE_CUTOUT';" +
            "}" +
            "if(b.bottom>innerHeight+3)return 'NAV_OUTSIDE_SCREEN';" +
            "return 'OK';})()"
        );
        assertEquals("Android API " + Build.VERSION.SDK_INT +
                " tab hit targets must stay above measured system bars",
                "\"OK\"", state);
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
