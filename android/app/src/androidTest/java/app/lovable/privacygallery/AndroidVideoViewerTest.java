package app.lovable.privacygallery;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
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

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/**
 * Video end-to-end: a disposable silent H.264 baseline MP4 is written to
 * Android MediaStore and opened through the ACTUAL Nova album/player.
 * Never scans, edits, or deletes media outside the unique CI fixture.
 */
@RunWith(AndroidJUnit4.class)
public final class AndroidVideoViewerTest {
    @Rule(order = 0)
    public GrantPermissionRule mediaPermissions = Build.VERSION.SDK_INT >= 33
            ? GrantPermissionRule.grant("android.permission.READ_MEDIA_IMAGES",
                    "android.permission.READ_MEDIA_VIDEO")
            : Build.VERSION.SDK_INT < 29
                ? GrantPermissionRule.grant("android.permission.READ_EXTERNAL_STORAGE",
                        "android.permission.WRITE_EXTERNAL_STORAGE")
                : GrantPermissionRule.grant("android.permission.READ_EXTERNAL_STORAGE");
    @Rule(order = 1)
    public ActivityScenarioRule<MainActivity> scenario =
            new ActivityScenarioRule<>(MainActivity.class);

    private Uri ownUri;
    private File ownLegacyFile;
    private String ownName;
    private static final String OWN_ALBUM = "Nova-CI-Video";

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int i = 0; i < parent.getChildCount(); i++) {
                WebView child = findWebView(parent.getChildAt(i));
                if (child != null) return child;
            }
        }
        return null;
    }

    private static String jsString(String text) {
        return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    private boolean eval(String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> answer = new AtomicReference<>("");
        scenario.getScenario().onActivity(activity -> {
            WebView web = findWebView(activity.getWindow().getDecorView());
            if (web == null) { latch.countDown(); return; }
            web.evaluateJavascript("(function(){try{return !!(" + expression +
                    ");}catch(e){return false;}})()", result -> {
                answer.set(result);
                latch.countDown();
            });
        });
        return latch.await(2500L, TimeUnit.MILLISECONDS) && "true".equals(answer.get());
    }

    private void until(String step, String expression) throws Exception {
        long expires = SystemClock.elapsedRealtime() + 28_000L;
        while (SystemClock.elapsedRealtime() < expires) {
            if (eval(expression)) return;
            SystemClock.sleep(300L);
        }
        fail("Native video E2E failed at " + step + " on API " + Build.VERSION.SDK_INT);
    }

    private void createOwnVideo() throws Exception {
        ownName = "nova-ci-video-" + UUID.randomUUID() + ".mp4";
        ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
                .getTargetContext().getContentResolver();
        InputStream source = InstrumentationRegistry.getInstrumentation()
                .getContext().getAssets().open("nova-ci-h264.mp4");
        try (InputStream input = source) {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Video.Media.DISPLAY_NAME, ownName);
                values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                values.put(MediaStore.Video.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_MOVIES + "/" + OWN_ALBUM + "/");
                values.put(MediaStore.Video.Media.IS_PENDING, 1);
                ownUri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                assertNotNull("Cannot create temporary CI video", ownUri);
                try (OutputStream output = resolver.openOutputStream(ownUri)) {
                    assertNotNull(output);
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                ContentValues complete = new ContentValues();
                complete.put(MediaStore.Video.Media.IS_PENDING, 0);
                resolver.update(ownUri, complete, null, null);
            } else {
                File directory = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_MOVIES), OWN_ALBUM);
                assertTrue(directory.exists() || directory.mkdirs());
                ownLegacyFile = new File(directory, ownName);
                try (OutputStream output = new FileOutputStream(ownLegacyFile)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                CountDownLatch indexed = new CountDownLatch(1);
                AtomicReference<Uri> indexedUri = new AtomicReference<>();
                MediaScannerConnection.scanFile(
                        InstrumentationRegistry.getInstrumentation().getTargetContext(),
                        new String[]{ownLegacyFile.getAbsolutePath()},
                        new String[]{"video/mp4"}, (path, uri) -> {
                            indexedUri.set(uri);
                            indexed.countDown();
                        });
                assertTrue("Temporary CI MP4 not indexed", indexed.await(12L, TimeUnit.SECONDS));
                ownUri = indexedUri.get();
                assertNotNull(ownUri);
            }
        }
    }

    private void cleanupOwnVideo() {
        if (ownName == null || !ownName.startsWith("nova-ci-video-")) return;
        try {
            if (ownUri != null) InstrumentationRegistry.getInstrumentation()
                    .getTargetContext().getContentResolver().delete(ownUri, null, null);
        } catch (Exception ignored) { /* Best-effort CI fixture cleanup only. */ }
        if (ownLegacyFile != null && ownLegacyFile.getName().equals(ownName)) {
            ownLegacyFile.delete();
            File directory = ownLegacyFile.getParentFile();
            if (directory != null && OWN_ALBUM.equals(directory.getName())) directory.delete();
        }
    }

    @Test
    public void realMediaStoreVideoOpensAndAdvancesInNativePlayer() throws Exception {
        try {
            createOwnVideo();
            scenario.getScenario().onActivity(activity -> {
                WebView web = findWebView(activity.getWindow().getDecorView());
                assertNotNull(web);
                web.reload();
            });
            until("real video album",
                    "(function(){return Array.from(document.querySelectorAll('a[href*=\\\"/gallery/\\\"]'))" +
                    ".some(function(a){return a.textContent.indexOf('" + OWN_ALBUM + "')>=0;});})()");
            until("open real video album", "(function(){" +
                    "if(location.pathname.indexOf('/gallery/')>=0||location.hash.indexOf('/gallery/')>=0)return true;" +
                    "var a=Array.from(document.querySelectorAll('a[href*=\\\"/gallery/\\\"]'))" +
                    ".filter(function(a){return a.textContent.indexOf('" + OWN_ALBUM + "')>=0;})[0];" +
                    "if(a)a.click();return false;})()");
            String button = "button[aria-label=" + jsString(ownName) + "]";
            until("video tile in opened album",
                    "!!document.querySelector(" + jsString(button) + ")");
            assertTrue("Cannot tap real video tile", eval("(function(){" +
                    "document.querySelector(" + jsString(button) + ").click();return true;})()"));
            until("native video metadata", "(function(){" +
                    "var v=document.querySelector('[data-nova-media-viewer] video[data-viewer-media]');" +
                    "return !!(v&&v.readyState>=1&&v.videoWidth===64&&v.videoHeight===64&&" +
                    "v.duration>=1.5&&v.duration<=3);})()");
            // A direct play click is a user-style player interaction. Do not
            // claim success merely because video metadata or a JS toast exists.
            assertTrue("Could not start real video", eval("(function(){" +
                    "var v=document.querySelector('video[data-viewer-media]');" +
                    "if(!v)return false;v.muted=true;v.play();return true;})()"));
            until("actual decoded video playback advances", "(function(){" +
                    "var v=document.querySelector('video[data-viewer-media]');" +
                    "return !!(v&&!v.paused&&v.currentTime>0.15&&v.videoWidth===64);})()");
            android.graphics.Bitmap screenshot = InstrumentationRegistry.getInstrumentation()
                    .getUiAutomation().takeScreenshot();
            assertNotNull("Actual video was not painted to Android compositor", screenshot);
            try {
                assertTrue("Video player did not paint native pixels",
                        RenderedSurfaceProbe.hasUiContrast(screenshot));
            } finally { screenshot.recycle(); }
        } finally {
            cleanupOwnVideo();
        }
    }
}
