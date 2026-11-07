package app.lovable.privacygallery;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.util.Base64;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/** Never touches personal media: test writes stay under the APK cache. */
@RunWith(AndroidJUnit4.class)
public class PublicMediaStreamsTest {
    @Test public void decodesLargePayloadThroughBoundedChunks() throws Exception {
        byte[] data = new byte[2 * 1024 * 1024 + 13];
        for (int i = 0; i < data.length; i++) data[i] = (byte) (i * 13);
        String encoded = Base64.encodeToString(data, Base64.NO_WRAP);
        ByteArrayOutputStream dest = new ByteArrayOutputStream();
        try (InputStream input = PublicMediaStreams.fromBase64("data:video/mp4;base64," + encoded)) {
            PublicMediaStreams.copy(input, dest);
        }
        assertArrayEquals(data, dest.toByteArray());
    }

    @Test public void handlesRawPayloadAndRejectsNonAscii() throws Exception {
        ByteArrayOutputStream dest = new ByteArrayOutputStream();
        try (InputStream input = PublicMediaStreams.fromBase64("AAECAwQ=")) {
            PublicMediaStreams.copy(input, dest);
        }
        assertArrayEquals(new byte[] {0, 1, 2, 3, 4}, dest.toByteArray());
        try (InputStream input = PublicMediaStreams.fromBase64("éé")) {
            PublicMediaStreams.copy(input, new ByteArrayOutputStream());
            fail("Must reject non-ASCII data");
        } catch (IOException expected) { }
    }

    private File newTestDir(String tag) {
        File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
        File dir = new File(cache, tag + "-" + System.nanoTime());
        assertTrue(dir.mkdirs());
        return dir;
    }

    private byte[] load(File file) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = new FileInputStream(file)) {
            PublicMediaStreams.copy(in, out);
        }
        return out.toByteArray();
    }

    private void removeTestDir(File dir) {
        File[] list = dir.listFiles();
        if (list != null) for (File file : list) file.delete();
        dir.delete();
    }

    @Test public void legacyWriterPreservesExistingPublicNames() throws Exception {
        File dir = newTestDir("nova-media-existing");
        try {
            File existing = new File(dir, "photo.jpg");
            try (FileOutputStream output = new FileOutputStream(existing)) {
                output.write("existing".getBytes(StandardCharsets.UTF_8));
            }
            File saved;
            try (InputStream media = PublicMediaStreams.fromBase64("bmV3")) {
                saved = PublicMediaStreams.writeLegacy(dir, "photo.jpg", media);
            }
            assertEquals("1_photo.jpg", saved.getName());
            assertEquals("existing", new String(load(existing), StandardCharsets.UTF_8));
            assertEquals("new", new String(load(saved), StandardCharsets.UTF_8));
        } finally { removeTestDir(dir); }
    }

    @Test public void writeFailureRemovesReservationAndPartiallyStagedMedia() throws Exception {
        File dir = newTestDir("nova-media-failed");
        InputStream broken = new InputStream() {
            private int calls;
            @Override public int read() throws IOException {
                if (calls++ < 2) return 32;
                throw new IOException("Simulated read failure");
            }
            @Override public int read(byte[] dst, int off, int len) throws IOException {
                if (calls++ < 2) { dst[off] = 32; return 1; }
                throw new IOException("Simulated read failure");
            }
        };
        try {
            PublicMediaStreams.writeLegacy(dir, "photo.jpg", broken);
            fail("Media write must fail");
        } catch (IOException expected) {
            assertEquals(0, dir.listFiles().length);
        } finally { removeTestDir(dir); }
    }
}
