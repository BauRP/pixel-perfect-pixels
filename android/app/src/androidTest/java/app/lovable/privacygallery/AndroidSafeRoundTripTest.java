package app.lovable.privacygallery;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.MediaStore;
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

import java.io.InputStream;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/**
 * Full native Safe E2E on a disposable CI emulator: actual PIN UI, AES
 * encryption, private Filesystem storage, WebView restart, PIN re-entry,
 * decrypted preview, native restore to MediaStore and post-restore cleanup.
 * Does not inspect, delete or even name any personal media.
 */
@RunWith(AndroidJUnit4.class)
public final class AndroidSafeRoundTripTest {
    @Rule(order = 0)
    public GrantPermissionRule storagePermission = Build.VERSION.SDK_INT >= 33
            ? GrantPermissionRule.grant("android.permission.READ_MEDIA_IMAGES",
                    "android.permission.READ_MEDIA_VIDEO")
            : Build.VERSION.SDK_INT < 29
                ? GrantPermissionRule.grant("android.permission.READ_EXTERNAL_STORAGE",
                        "android.permission.WRITE_EXTERNAL_STORAGE")
                : GrantPermissionRule.grant("android.permission.READ_EXTERNAL_STORAGE");

    @Rule(order = 1)
    public ActivityScenarioRule<MainActivity> scenario =
            new ActivityScenarioRule<>(MainActivity.class);

    private static final String PNG_B64 =
            "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP84KbBwMDAxMDAwMDAAAARWgFi7u3UigAAAABJRU5ErkJggg==";
    private Uri restored;
    private String ownName;

    private static WebView webView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int i = 0; i < parent.getChildCount(); i++) {
                WebView web = webView(parent.getChildAt(i));
                if (web != null) return web;
            }
        }
        return null;
    }

    private boolean js(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> output = new AtomicReference<>("");
        scenario.getScenario().onActivity(activity -> {
            WebView web = webView(activity.getWindow().getDecorView());
            if (web == null) { done.countDown(); return; }
            web.evaluateJavascript("(function(){try{return !!(" + expression +
                    ");}catch(e){return false;}})()", value -> {
                output.set(value);
                done.countDown();
            });
        });
        return done.await(2500L, TimeUnit.MILLISECONDS) && "true".equals(output.get());
    }

    private void until(String stage, String expression) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 32_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (js(expression)) return;
            SystemClock.sleep(260L);
        }
        fail("Safe full round-trip failed at " + stage + " on Android API "
                + Build.VERSION.SDK_INT);
    }

    private void enterPin() throws Exception {
        for (int digit = 1; digit <= 4; digit++) {
            String selector = "[data-safe-pin-key=\"" + digit + "\"]";
            assertTrue("Safe PIN digit unavailable", js(
                    "(function(){var b=document.querySelector('" + selector +
                    "');if(!b)return false;b.click();return true;})()"));
            SystemClock.sleep(85L);
        }
    }

    private void awaitPublishedImage() throws Exception {
        ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
                .getTargetContext().getContentResolver();
        long deadline = SystemClock.elapsedRealtime() + 25_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            try (Cursor cursor = resolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.SIZE },
                    MediaStore.Images.Media.DISPLAY_NAME + "=?",
                    new String[] { ownName }, null)) {
                if (cursor != null && cursor.moveToFirst() && cursor.getLong(1) > 0) {
                    restored = ContentUris.withAppendedId(
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cursor.getLong(0));
                    break;
                }
            }
            SystemClock.sleep(300L);
        }
        assertNotNull("Native restore did not publish the Safe PNG", restored);
        try (InputStream input = resolver.openInputStream(restored)) {
            assertNotNull("Native restored file cannot be opened", input);
            Bitmap b = android.graphics.BitmapFactory.decodeStream(input);
            assertNotNull("Restored media could not be decoded", b);
            try { assertEquals(2, b.getWidth()); assertEquals(2, b.getHeight()); }
            finally { b.recycle(); }
        }
    }

    @Test
    public void encryptedPhotoSurvivesRestartAndRestoresThroughRealAndroidMediaStore()
            throws Exception {
        ownName = "nova-ci-safe-" + UUID.randomUUID() + ".png";
        try {
            until("gallery boot", "!!document.querySelector('[data-bottom-nav]')");
            assertTrue("Safe navigation unavailable", js(
                    "(function(){var a=document.querySelector(" +
                    "'[data-bottom-nav] a[href*=\\\"/safe\\\"]');" +
                    "if(!a)return false;a.click();return true;})()"));
            until("first PIN setup", "!!document.querySelector(" +
                    "'[data-safe-pin-stage=enter]')");
            enterPin();
            until("confirmation PIN screen", "!!document.querySelector(" +
                    "'[data-safe-pin-stage=confirm]')");
            enterPin();
            until("Safe unlocked", "!!document.querySelector('[data-safe-create-folder]')");
            assertTrue(js("(function(){document.querySelector(" +
                    "'[data-safe-create-folder]').click();return true;})()"));
            until("folder name input", "!!document.querySelector('[data-safe-folder-name]')");
            assertTrue("Cannot set folder name", js("(function(){var e=document.querySelector(" +
                    "'[data-safe-folder-name]');if(!e)return false;" +
                    "var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;" +
                    "s.call(e,'Nova-CI-Safe');e.dispatchEvent(new Event('input',{bubbles:true}));" +
                    "return true;})()"));
            until("create folder enabled", "(function(){var b=document.querySelector(" +
                    "'[data-safe-create-submit]');return !!(b&&!b.disabled);})()");
            assertTrue(js("(function(){document.querySelector(" +
                    "'[data-safe-create-submit]').click();return true;})()"));
            until("Safe folder route", "!!document.querySelector('[data-safe-file-input]')");
            String upload = "(function(){var e=document.querySelector('[data-safe-file-input]');" +
                    "if(!e||typeof DataTransfer==='undefined')return false;" +
                    "var d=new DataTransfer(),raw=atob('" + PNG_B64 + "'),bytes=new Uint8Array(raw.length);" +
                    "for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);" +
                    "d.items.add(new File([bytes],'" + ownName + "',{type:'image/png'}));" +
                    "e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));" +
                    "return true;})()";
            assertTrue("Could not select disposable PNG for real Safe import", js(upload));
            until("encrypted metadata committed and native blob referenced",
                    "(function(){var x=JSON.parse(localStorage.getItem('vault.store.v3')||'{}');" +
                    "return !!(x.folders&&x.folders.some(function(f){" +
                    "return f.name==='Nova-CI-Safe'&&f.files.length===1&&" +
                    "!!f.files[0].blobPath&&!f.files[0].cipher;}));})()");
            until("encrypted file visible", "!!document.querySelector('[data-safe-private-file]')");
            // Reload the actual WebView, not only the React route. AES key is
            // RAM-only and must require a new real PIN authentication.
            scenario.getScenario().onActivity(activity -> {
                WebView web = webView(activity.getWindow().getDecorView());
                assertNotNull(web);
                web.reload();
            });
            until("PIN required after WebView restart",
                    "!!document.querySelector('[data-safe-pin-stage=unlock]')");
            assertFalse("Private preview visible before re-unlocking", js(
                    "!!document.querySelector('[data-safe-decrypted-image]')"));
            enterPin();
            until("encrypted file indexed after restart",
                    "!!document.querySelector('[data-safe-private-file]')");
            assertTrue("Cannot open encrypted file", js(
                    "(function(){document.querySelector('[data-safe-private-file]')" +
                    ".click();return true;})()"));
            until("AES decrypted PNG visible in private viewer",
                    "(function(){var x=document.querySelector('[data-safe-decrypted-image]');" +
                    "return !!(x&&x.complete&&x.naturalWidth===2&&x.naturalHeight===2);})()");
            assertTrue("Restore button did not respond", js(
                    "(function(){document.querySelector('[data-safe-restore]')" +
                    ".click();return true;})()"));
            awaitPublishedImage();
            until("original encrypted index cleared after successful native restore",
                    "(function(){var x=JSON.parse(localStorage.getItem('vault.store.v3')||'{}');" +
                    "return !!(x.folders&&x.folders.some(function(f){" +
                    "return f.name==='Nova-CI-Safe'&&f.files.length===0;}));})()");
        } finally {
            if (restored != null) {
                try {
                    InstrumentationRegistry.getInstrumentation().getTargetContext()
                            .getContentResolver().delete(restored, null, null);
                } catch (Exception ignored) { /* Delete only own UUID CI asset. */ }
            }
        }
    }
}
