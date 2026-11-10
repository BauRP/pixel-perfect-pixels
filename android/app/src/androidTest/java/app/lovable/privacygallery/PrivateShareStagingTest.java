package app.lovable.privacygallery;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.util.Base64;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/** Uses only private test cache, never personal photos or Safe contents. */
@RunWith(AndroidJUnit4.class)
public class PrivateShareStagingTest {
    private File newCacheRoot() {
        File base = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
        File root = new File(base, "share-staging-test-" + System.nanoTime());
        assertTrue(root.mkdirs());
        return root;
    }

    private void remove(File path) {
        if (path.isDirectory()) {
            File[] files = path.listFiles();
            if (files != null) for (File file : files) remove(file);
        }
        path.delete();
    }

    private byte[] contents(File path) throws Exception {
        try (FileInputStream input = new FileInputStream(path);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PublicMediaStreams.copy(input, out);
            return out.toByteArray();
        }
    }

    @Test public void repeatedNamesNeverReplaceAnExistingShare() throws Exception {
        File root = newCacheRoot();
        try {
            File first = PrivateShareStaging.stageBase64(root, "photo.jpg", "b25l");
            File second = PrivateShareStaging.stageBase64(root, "photo.jpg", "dHdv");
            assertEquals("photo.jpg", first.getName());
            assertEquals("photo.jpg", second.getName());
            assertNotEquals(first.getParent(), second.getParent());
            assertEquals("one", new String(contents(first), StandardCharsets.UTF_8));
            assertEquals("two", new String(contents(second), StandardCharsets.UTF_8));
            PrivateShareStaging.discard(second);
            assertTrue(first.exists());
            assertFalse(second.exists());
        } finally { remove(root); }
    }

    @Test public void largeShareUsesBoundedStreamingAndPreservesAllBytes() throws Exception {
        File root = newCacheRoot();
        try {
            byte[] data = new byte[2 * 1024 * 1024 + 3];
            for (int i = 0; i < data.length; i++) data[i] = (byte) (i * 7);
            File result = PrivateShareStaging.stageBase64(
                    root, "video.mp4", Base64.encodeToString(data, Base64.NO_WRAP));
            assertArrayEquals(data, contents(result));
        } finally { remove(root); }
    }

    @Test public void brokenMediaDoesNotLeavePartialPlaintextInCache() throws Exception {
        File root = newCacheRoot();
        try {
            try {
                PrivateShareStaging.stageBase64(root, "..", "\u00E9");
                fail("Non-ASCII encoded data must be rejected");
            } catch (java.io.IOException expected) { }
            File[] entries = new File(root, "shared").listFiles();
            assertNotNull(entries);
            assertEquals(0, entries.length);
        } finally { remove(root); }
    }

    @Test public void expirationKeepsRecentExportsAndRemovesOnlyOldCopies() throws Exception {
        File root = newCacheRoot();
        try {
            File old = PrivateShareStaging.stageBase64(root, "old.jpg", "b2xk");
            File fresh = PrivateShareStaging.stageBase64(root, "fresh.jpg", "bmV3");
            long now = System.currentTimeMillis();
            assertTrue(old.getParentFile().setLastModified(
                    now - PrivateShareStaging.RETAIN_MILLIS - 1000L));
            PrivateShareStaging.cleanupExpired(root, now);
            assertFalse(old.exists());
            assertTrue(fresh.exists());
            assertEquals("new", new String(contents(fresh), StandardCharsets.UTF_8));
        } finally { remove(root); }
    }
}
