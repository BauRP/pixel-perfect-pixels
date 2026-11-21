package app.lovable.privacygallery;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
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
    private String editedFilename;
    private Uri editedUri;

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
        // Diagnostics contain only booleans/counts, never personal filenames or
        // private file paths. A missing tile is NOT silently retried as success.
        String detail = "";
        if ("media thumbnail in album".equals(step) || "album route after card tap".equals(step)) {
            detail = " (albumRoute=" + eval("location.pathname.indexOf('/gallery/')>=0 || location.hash.indexOf('/gallery/')>=0") +
                    ", rootAlbumLinks=" + eval("document.querySelectorAll('a[href*=\\\"/gallery/\\\"]').length>0") +
                    ", mediaTiles=" + eval("document.querySelectorAll('button[aria-label]').length>4") +
                    ", appContent=" + eval("!!document.querySelector('[data-app-content]')") + ")";
        }
        fail("Genuine Android photo viewer failed at " + step +
                " on API " + Build.VERSION.SDK_INT + detail);
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

    /**
     * Verify that the actual native SaveImage plugin published a readable
     * exported JPEG into Android's MediaStore. Never count a JS toast or a
     * returned file path alone as a successful edit export.
     */
    private void awaitPublishedEditedJpeg() throws Exception {
        editedFilename = filename.replace(".jpg", "_edited.jpg");
        ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
                .getTargetContext().getContentResolver();
        long deadline = SystemClock.elapsedRealtime() + 28_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            try (android.database.Cursor cursor = resolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.SIZE },
                    MediaStore.Images.Media.DISPLAY_NAME + "=?",
                    new String[] { editedFilename }, null)) {
                if (cursor != null && cursor.moveToFirst() && cursor.getLong(1) > 0) {
                    editedUri = android.content.ContentUris.withAppendedId(
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cursor.getLong(0));
                    break;
                }
            }
            SystemClock.sleep(300);
        }
        assertNotNull("Edited JPEG was not published into Android MediaStore", editedUri);
        BitmapFactory.Options dimensions = new BitmapFactory.Options();
        dimensions.inJustDecodeBounds = true;
        try (java.io.InputStream stream = resolver.openInputStream(editedUri)) {
            assertNotNull("Exported JPEG cannot be read", stream);
            BitmapFactory.decodeStream(stream, null, dimensions);
        }
        assertEquals("Rotated JPEG must have swapped width", 112, dimensions.outWidth);
        assertEquals("Rotated JPEG must have swapped height", 160, dimensions.outHeight);
        assertEquals("Export format must be JPEG", "image/jpeg", dimensions.outMimeType);
        Bitmap decoded;
        try (java.io.InputStream stream = resolver.openInputStream(editedUri)) {
            assertNotNull("Exported JPEG cannot be decoded", stream);
            decoded = BitmapFactory.decodeStream(stream);
        }
        assertNotNull("Exported JPEG has no pixels", decoded);
        try {
            assertEquals(112, decoded.getWidth());
            assertEquals(160, decoded.getHeight());
            int firstPixel = decoded.getPixel(4, 4), otherPixels = 0;
            for (int y = 0; y < decoded.getHeight(); y += 9)
                for (int x = 0; x < decoded.getWidth(); x += 9)
                    if (decoded.getPixel(x, y) != firstPixel) otherPixels++;
            assertTrue("Exported photo has no visible fixture detail", otherPixels > 8);
            // Also prove that the editor's black/white filter was actually
            // baked into exported JPEG pixels, not merely CSS preview.
            int gray = 0, total = 0;
            for (int y = 8; y < decoded.getHeight() - 8; y += 11) {
                for (int x = 8; x < decoded.getWidth() - 8; x += 11) {
                    int pixel = decoded.getPixel(x, y);
                    if (Math.abs(Color.red(pixel) - Color.green(pixel)) <= 12
                            && Math.abs(Color.green(pixel) - Color.blue(pixel)) <= 12) gray++;
                    total++;
                }
            }
            assertTrue("Black-and-white filter was not exported into JPEG pixels",
                    total > 20 && gray * 100 >= total * 90);
        } finally { decoded.recycle(); }
    }

    private void cleanupOwnImage() {
        if (filename == null || !filename.startsWith("nova-ci-photo-")) return;
        try {
            if (mediaUri != null) {
                InstrumentationRegistry.getInstrumentation().getTargetContext()
                        .getContentResolver().delete(mediaUri, null, null);
            }
        } catch (Exception ignored) { /* Cleanup only the disposable CI asset. */ }
        // Only our test-specific edited output, never unrelated media.
        // A publish may succeed but the test may fail before indexing; in
        // that case use the exact UUID-derived path on legacy Android.
        if (editedFilename != null && editedFilename.equals(
                filename.replace(".jpg", "_edited.jpg"))) {
            ContentResolver resolver = InstrumentationRegistry.getInstrumentation()
                    .getTargetContext().getContentResolver();
            try {
                if (editedUri != null) resolver.delete(editedUri, null, null);
            } catch (Exception ignored) { /* Best-effort own test output cleanup. */ }
            if (Build.VERSION.SDK_INT < 29) {
                File generated = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_PICTURES), "NovaGallery/" + editedFilename);
                if (generated.isFile()) generated.delete();
            }
        }
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
            // A first synthetic click can be dropped by the Android
            // WebView even when the album is present. The following bounded
            // route waiter retries the real link and checks navigation.
            eval("(function(){var a=Array.from(document.querySelectorAll(" +
                    "'a[href*=\\\"/gallery/\\\"]')).filter(function(e){" +
                    "return e.textContent.indexOf('Nova-CI-Viewer')>=0;})[0];" +
                    "if(a)a.click();return !!a;})()");

            // On older Android WebViews one synthetic bridge click can be
            // dropped even while the gallery is visibly responsive. Retry
            // the SAME real album link at most once per 1500ms, never force a
            // route or bypass its normal onClick handler. The real album
            // screen and decoded photo remain mandatory PASS conditions.
            until("album route after card tap",
                    "(function(){if(location.pathname.indexOf('/gallery/')>=0||" +
                    "location.hash.indexOf('/gallery/')>=0)return true;" +
                    "var now=Date.now(),last=window.__novaCiLastAlbumTap||0;" +
                    "if(now-last<1500)return false;window.__novaCiLastAlbumTap=now;" +
                    "var link=Array.from(document.querySelectorAll('a[href*=\\\"/gallery/\\\"]'))" +
                    ".filter(function(e){return e.textContent.indexOf('Nova-CI-Viewer')>=0;})[0];" +
                    "if(link)link.click();return false;})()");
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

            // The rotate buttons are in viewer mode; exit editor first,
            // rotate the original preview, then reopen the editor and Apply.
            until("editor cancel button", "!!document.querySelector('[data-viewer-cancel]')");
            assertTrue("Could not exit editor after Reset", eval(
                    "(function(){document.querySelector('[data-viewer-cancel]')" +
                    ".click();return true;})()"));
            until("viewer rotation control", "!!document.querySelector('[data-viewer-action=rotate-right]')");
            assertTrue("Could not rotate edited image", eval(
                    "(function(){document.querySelector('[data-viewer-action=rotate-right]')" +
                    ".click();return true;})()"));
            until("export rotation preview",
                    "(function(){var i=document.querySelector('img[data-viewer-media]');" +
                    "return i&&i.style.transform.indexOf('rotate(90deg)')>=0;})()");
            assertTrue("Could not reopen photo editor before saving", eval(
                    "(function(){document.querySelector('[data-viewer-action=edit]')" +
                    ".click();return true;})()"));
            until("real Apply button", "!!document.querySelector('[data-viewer-apply]')");
            assertTrue("Could not open real photo filters", eval(
                    "(function(){document.querySelector('[data-viewer-action=filters]')" +
                    ".click();return true;})()"));
            until("black-and-white filter option",
                    "!!document.querySelector('[data-filter-preset=bw]')");
            assertTrue("Could not choose black-and-white", eval(
                    "(function(){document.querySelector('[data-filter-preset=bw]')" +
                    ".click();return true;})()"));
            until("grayscale photo preview",
                    "(function(){var img=document.querySelector('img[data-viewer-media]');" +
                    "return !!(img&&img.style.filter.indexOf('grayscale(1)')>=0);})()");
            assertTrue("Could not invoke native image export", eval(
                    "(function(){document.querySelector('[data-viewer-apply]')" +
                    ".click();return true;})()"));
            awaitPublishedEditedJpeg();
            until("editor exits after saved image",
                    "!!document.querySelector('[data-viewer-action=edit]')");

            // The original remains exactly as before SaveImage made the new
            // file. Deletion/corruption of the source is a test failure.
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
