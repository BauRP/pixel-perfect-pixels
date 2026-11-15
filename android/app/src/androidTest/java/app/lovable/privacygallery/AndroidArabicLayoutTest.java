package app.lovable.privacygallery;

import android.graphics.Bitmap;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.GrantPermissionRule;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/** Real language selection + LTR navigation / RTL text on Android 7+ WebView.
 * Tests the actual Settings dropdown and system-composited screenshot, not a
 * mocked React DOM, CSS snapshot or manual localStorage modification.
 */
@RunWith(AndroidJUnit4.class)
public class AndroidArabicLayoutTest {
    @Rule(order = 0)
    public GrantPermissionRule mediaPermissions = Build.VERSION.SDK_INT >= 33
            ? GrantPermissionRule.grant(
                    "android.permission.READ_MEDIA_IMAGES",
                    "android.permission.READ_MEDIA_VIDEO")
            : GrantPermissionRule.grant("android.permission.READ_EXTERNAL_STORAGE");

    @Rule(order = 1)
    public ActivityScenarioRule<MainActivity> scenario =
            new ActivityScenarioRule<>(MainActivity.class);

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int i = 0; i < parent.getChildCount(); i++) {
                WebView result = findWebView(parent.getChildAt(i));
                if (result != null) return result;
            }
        }
        return null;
    }

    private boolean evaluate(String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>("");
        scenario.getScenario().onActivity(activity -> {
            WebView web = findWebView(activity.getWindow().getDecorView());
            if (web == null) { latch.countDown(); return; }
            web.evaluateJavascript("(function(){try{return !!(" + expression +
                    ");}catch(e){return false;}})()", value -> {
                result.set(value);
                latch.countDown();
            });
        });
        return latch.await(2, TimeUnit.SECONDS) && "true".equals(result.get());
    }

    private void awaitUi(String label, String expression) throws Exception {
        long until = SystemClock.elapsedRealtime() + 20_000L;
        while (SystemClock.elapsedRealtime() < until) {
            if (evaluate(expression)) return;
            SystemClock.sleep(250L);
        }
        fail("Arabic UI failed at " + label + " on API " + Build.VERSION.SDK_INT);
    }

    private void selectLanguage(String lang) throws Exception {
        awaitUi("language trigger", "!!document.querySelector('[data-language-select-trigger]')");
        // Open the REAL Radix menu, retrying dropped legacy WebView callbacks.
        awaitUi("language options", "(function(){" +
                "if(document.querySelector('[data-language-option=" + lang + "]'))return true;" +
                "var e=document.querySelector('[data-language-select-trigger]');" +
                "if(!e)return false;e.focus();" +
                "e.dispatchEvent(new KeyboardEvent('keydown',{" +
                "key:'Enter',code:'Enter',bubbles:true,cancelable:true}));return false;})()");
        evaluate("(function(){var e=document.querySelector('[data-language-option=" +
                lang + "]');if(!e)return false;e.click();return true;})()");
        awaitUi("selected " + lang, "localStorage.getItem('vault.lang')==='" + lang +
                "'&&document.documentElement.lang==='" + lang + "'");
    }

    @Test
    public void arabicTextIsRtlButControlsStayLtrAndLanguageSurvivesRestart() throws Exception {
        try {
            awaitUi("bottom navigation", "!!document.querySelector('[data-bottom-nav] a[href*=\"settings\"]')");
            assertTrue("Could not open Settings", evaluate(
                    "(function(){document.querySelector('[data-bottom-nav] " +
                    "a[href*=\"settings\"]').click();return true;})()"));
            awaitUi("language selector", "!!document.querySelector('[data-language-select-trigger]')");
            selectLanguage("ar");
            String base = "document.documentElement.lang==='ar'&&" +
                    "document.documentElement.dir==='ltr'&&" +
                    "!!document.querySelector('h1[data-localized-text]')&&" +
                    "!!document.querySelector('[data-bottom-nav]')";
            awaitUi("Arabic document locale and heading", base);
            String heading = "(function(){" +
                    "var e=document.querySelector('h1[data-localized-text]');" +
                    "return e.textContent.indexOf('الإعدادات')>=0&&" +
                    "getComputedStyle(e).direction==='rtl';})()";
            awaitUi("Arabic settings heading text direction", heading);
            String labels = "(function(){" +
                    "var nav=document.querySelector('[data-bottom-nav]');" +
                    "var xs=nav.querySelectorAll('a [data-localized-text]');" +
                    "return getComputedStyle(nav).direction==='ltr'&&xs.length===3&&" +
                    "Array.from(xs).every(function(x){" +
                    "return getComputedStyle(x).direction==='rtl';});})()";
            awaitUi("Arabic text on three bottom tabs", labels);
            String positions = "(function(){" +
                    "var nav=document.querySelector('[data-bottom-nav]');" +
                    "var links=nav.querySelectorAll('a');" +
                    "if(links.length!==3)return false;" +
                    "var xs=Array.from(links).map(function(x){return x.getBoundingClientRect();});" +
                    "return xs[0].left<xs[1].left&&xs[1].left<xs[2].left&&" +
                    "xs.every(function(x){return x.width>35&&x.height>=48;});})()";
            awaitUi("LTR three-tab order and 48px targets", positions);

            // Pixel evidence complements the DOM contract: CSS-only checks
            // can pass with an entirely black compositor on API29/33.
            SystemClock.sleep(350);
            Bitmap screenshot = InstrumentationRegistry.getInstrumentation()
                    .getUiAutomation().takeScreenshot();
            assertNotNull("Android did not capture an Arabic UI screenshot", screenshot);
            try {
                assertTrue("Arabic screen has no readable UI pixels",
                        RenderedSurfaceProbe.hasUiContrast(screenshot));
            } finally {
                screenshot.recycle();
            }

            scenario.getScenario().onActivity(activity -> {
                WebView web = findWebView(activity.getWindow().getDecorView());
                assertNotNull(web);
                web.reload();
            });
            awaitUi("Arabic after real WebView reload",
                    "!!document.querySelector('[data-language-select-trigger]')&&" +
                    "localStorage.getItem('vault.lang')==='ar'&&" +
                    "document.documentElement.lang==='ar'");
            awaitUi("Arabic heading after reload", heading);
            awaitUi("Arabic tab labels after reload", labels);
            awaitUi("LTR tab geometry after reload", positions);
        } finally {
            // Disposable CI emulator: restore default test locale, never
            // touch media, PIN, password or user-protected storage.
            evaluate("(function(){localStorage.setItem('vault.lang','en');" +
                    "document.documentElement.lang='en';return true;})()");
        }
    }
}
