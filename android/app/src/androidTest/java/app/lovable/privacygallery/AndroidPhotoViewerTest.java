package app.lovable.privacygallery;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Canvas;
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
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.*;

/**
 * Genuine Android photo/viewer/editor E2E: create a distinct disposable CI
 * photo, let the application's real MediaStore scanner find it, navigate
 * through gallery -> album -> fullscreen viewer, rotate/edit/reset, and
 * verify the Android compositor actually painted the viewer. The test never
 * reads, edits or deletes any existing user media. Only its own uniquely
 * named CI image is removed in finally.
 */
@RunWith(AndroidJUnit4.class)
public final class AndroidPhotoViewerTest {
    @Rule(order = 0)
    public GrantPermissionRule mediaPermissions = Build.VERSION.SDK_INT >= 33
            ? GrantPermissionRule.grant(
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.READ_MEDIA_VIDEO")
            : Build.VERSION.SDK_INT < 29
                ? GrantPermissionRule.grant(
                    "android.permission.READ_EXTERNAL_STORAGE",
                    "android.permission.WRITE_EXTERNAL_STORAGE")
                : GrantPermissionRule.grant("android.permission.READ_EXTERNAL_STORAGE");

    @Rule(order = 1)
    public ActivityScenarioRule<MainActivity> scenario =
            new ActivityScenarioRule<>(MainActivity.class);

    private Uri mediaUri;
    private File legacyFile;
    private String filename;

    private static WebView findWebView(View v) {
        if (v instanceof WebView) return (WebView) v;
        if (v instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) v;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView child = findWebView(group.getChildAt(i));
                if (child != null) return child;
            }
        }
        return null;
    }

    private static String jsString(String text) {
        return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    private boolean eval(String expression) throws Exception {
        AtomicReference<String> result = new AtomicReference<>("");
        CountDownLatch latch = new CountDownLatch(1);
        scenario.getScenario().onActivity(activity -> {
            WebView web = findWebView(activity.getWindow().getDecorView());
            if (web == null) { latch.countDown(); return; }
            web.evaluateJavascript("(function(){try{return !!(" + expression +
                    ");}catch(e){return false;}})()", v -> {
                result.set(v);
                latch.countDown();
            });
        });
        return latch.await(2500, TimeUnit.MILLISECONDS) && "true".equals(result.get());
    }

    private void until(String step, String expression) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 24_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (eval(expression)) return;
            SystemClock.sleep(300);
        }
        fail("Genuine Android photo viewer failed at " + step +
                " on API " + Build.VERSION.SDK_INT);
    }

    private void createOwnImage() throws Exception {
        filename = "nova-ci-photo-" + UUID.randomUUID().toString() + ".jpg";
        Bitmap image = Bitmap.createBitmap(160, 112, Bitmap.Config.ARGB_8888);
        image.eraseColor(Color.rgb(36, 108, 230));
        Canvas canvas = new Canvas(image);
        Paint brush = new Paint();
        brush.setColor(Color.rgb(255, 235, 80));
        canvas.drawRect(16, 20, 145, 40, brush);
        brush.setColor(Color.WHITE);
        canvas.drawRect(26, 65, 126, 89, brush);
        ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
                .getTargetContext().getContentResolver();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/Nova-CI-Viewer/");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                mediaUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                assertNotNull("Could not create disposable MediaStore CI image", mediaUri);
                try (OutputStream os = resolver.openOutputStream(mediaUri)) {
                    assertNotNull(os);
                    assertTrue(image.compress(Bitmap.CompressFormat.JPEG, 92, os));
                }
                ContentValues finished = new ContentValues();
                finished.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(mediaUri, finished, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_PICTURES), "Nova-CI-Viewer");
                assertTrue("Cannot create isolated CI album", dir.exists() || dir.mkdirs());
                legacyFile = new File(dir, filename);
                try (OutputStream os = new FileOutputStream(legacyFile)) {
                    assertTrue(image.compress(Bitmap.CompressFormat.JPEG, 92, os));
                }
                CountDownLatch indexed = new CountDownLatch(1);
                AtomicReference<Uri> indexedUri = new AtomicReference<>();
                MediaScannerConnection.scanFile(
                        InstrumentationRegistry.getInstrumentation().getTargetContext(),
                        new String[] { legacyFile.getAbsolutePath() },
                        new String[] { "image/jpeg" },
                        (path, uri) -> { indexedUri.set(uri); indexed.countDown(); });
                assertTrue("CI image not indexed by Android MediaStore",
                        indexed.await(12, TimeUnit.SECONDS));
                mediaUri = indexedUri.get();
                assertNotNull("CI image missing MediaStore row", mediaUri);
            }
        } finally {
            image.recycle();
        }
    }

    private void cleanupOwnImage() {
        if (filename == null || !filename.startsWith("nova-ci-photo-")) return;
        try {
            if (mediaUri != null) {
                InstrumentationRegistry.getInstrumentation().getTargetContext()
                        .getContentResolver().delete(mediaUri, null, null);
            }
        } catch (Exception ignored) { /* Cleanup only the disposable CI asset. */ }
        if (legacyFile != null && legacyFile.getName().equals(filename)) {
            legacyFile.delete();
            File dir = legacyFile.getParentFile();
            if (dir != null && "Nova-CI-Viewer".equals(dir.getName())) dir.delete();
        }
    }

    @Test
    public void realImageOpensRotatesAndResetsInsideFullscreenViewer() throws Exception {
        try {
            createOwnImage();
            // Reload the real Android WebView so the regular gallery bootstrap
            // performs a fresh MediaStore scan and finds the seeded image.
            scenario.getScenario().onActivity(activity -> {
                WebView web = findWebView(activity.getWindow().getDecorView());
                assertNotNull(web);
                web.reload();
            });
            until("indexed album visible on gallery",
                    "(function(){var a=Array.from(document.querySelectorAll(" +
                    "'a[href*=\\\"/gallery/\\\"]')).filter(function(e){" +
                    "return e.textContent.indexOf('Nova-CI-Viewer')>=0;});return a.length===1;})()");
            assertTrue("Could not click the real MediaStore album", eval(
                    "(function(){var a=Array.from(document.querySelectorAll(" +
                    "'a[href*=\\\"/gallery/\\\"]')).filter(function(e){" +
                    "return e.textContent.indexOf('Nova-CI-Viewer')>=0;})[0];" +
                    "a.click();return true;})()"));

            final String tile = "button[aria-label=" + jsString(filename) + "]";
            until("media thumbnail in album", "!!document.querySelector(" + jsString(tile) + ")");
            assertTrue("Could not open real image", eval(
                    "(function(){document.querySelector(" + jsString(tile) +
                    ").click();return true;})()"));

            until("decoded fullscreen image",
                    "(function(){var v=document.querySelector('[data-nova-media-viewer]');" +
                    "var i=v&&v.querySelector('img[data-viewer-media]');" +
                    "return !!(i&&i.complete&&i.naturalWidth===160&&i.naturalHeight===112);})()");
            assertTrue("Rotating actual media failed", eval(
                    "(function(){document.querySelector('[data-viewer-action=rotate-right]')" +
                    ".click();return true;})()"));
            until("90 degree image transform",
                    "(function(){var i=document.querySelector('img[data-viewer-media]');" +
                    "return i&&i.style.transform.indexOf('rotate(90deg)')>=0;})()");
            assertTrue("Could not enter actual editor", eval(
                    "(function(){document.querySelector('[data-viewer-action=edit]')" +
                    ".click();return true;})()"));
            until("editor flip control", "!!document.querySelector('[data-viewer-action=flip-h]')");
            assertTrue("Flip horizontal failed", eval(
                    "(function(){document.querySelector('[data-viewer-action=flip-h]')" +
                    ".click();return true;})()"));
            until("horizontal flip preview",
                    "(function(){var i=document.querySelector('img[data-viewer-media]');" +
                    "return i&&i.style.transform.indexOf('scaleX(-1)')>=0;})()");
            assertTrue("Reset control failed", eval(
                    "(function(){document.querySelector('[data-viewer-action=reset]')" +
                    ".click();return true;})()"));
            until("original photo transform restored",
                    "(function(){var i=document.querySelector('img[data-viewer-media]');" +
                    "return i&&i.style.transform.indexOf('rotate(0deg)')>=0&&" +
                    "i.style.transform.indexOf('scaleX(1)')>=0;})()");

            Bitmap screenshot = InstrumentationRegistry.getInstrumentation()
                    .getUiAutomation().takeScreenshot();
            assertNotNull("No real fullscreen viewer screenshot", screenshot);
            try {
                assertTrue("Photo viewer did not paint contrasting native pixels",
                        RenderedSurfaceProbe.hasUiContrast(screenshot));
            } finally { screenshot.recycle(); }

            // Rotation, flip and reset are previews only until Apply is used.
            // Opening/previewing must not delete, overwrite or export the image.
            ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
                    .getTargetContext().getContentResolver();
            try (android.database.Cursor c = resolver.query(mediaUri,
                    new String[] { MediaStore.MediaColumns.SIZE }, null, null, null)) {
                assertNotNull(c);
                assertTrue("Original CI photo was unexpectedly deleted", c.moveToFirst());
                assertTrue("Original CI photo became empty", c.getLong(0) > 0);
            }
        } finally {
            cleanupOwnImage();
        }
    }
}
