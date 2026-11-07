package app.lovable.privacygallery;

import android.util.Base64;
import android.util.Base64InputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Stream decoded photos/videos in 64KiB chunks. The incoming Capacitor
 * argument is already one Java String: do not allocate an additional giant
 * ASCII base64 array or a fully decoded media byte[] on Android.
 */
final class PublicMediaStreams {
    private PublicMediaStreams() {}

    static InputStream fromBase64(String value) {
        if (value == null) throw new IllegalArgumentException("Missing media");
        final int marker = value.indexOf("base64,");
        final int start = marker < 0 ? 0 : marker + 7;
        InputStream ascii = new InputStream() {
            private int index = start;

            @Override public int read() throws IOException {
                if (index >= value.length()) return -1;
                char ch = value.charAt(index++);
                if (ch > 127) throw new IOException("Invalid encoded media");
                return ch;
            }

            @Override public int read(byte[] dst, int off, int len) throws IOException {
                if (dst == null) throw new NullPointerException();
                if (off < 0 || len < 0 || off > dst.length - len)
                    throw new IndexOutOfBoundsException();
                if (len == 0) return 0;
                if (index >= value.length()) return -1;
                int count = Math.min(len, value.length() - index);
                for (int n = 0; n < count; n++) {
                    char ch = value.charAt(index + n);
                    if (ch > 127) throw new IOException("Invalid encoded media");
                    dst[off + n] = (byte) ch;
                }
                index += count;
                return count;
            }
        };
        return new Base64InputStream(ascii, Base64.DEFAULT);
    }

    static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] chunk = new byte[64 * 1024];
        int n;
        while ((n = input.read(chunk)) != -1) {
            if (n > 0) output.write(chunk, 0, n);
        }
    }

    /**
     * Android 7–9: write to a hidden temporary file, fsync, then atomically
     * rename to a freshly reserved unique filename. Never overwrite existing
     * user media. On any failure remove both temporary and reserved files.
     */
    static File writeLegacy(File dir, String name, InputStream media) throws IOException {
        if (!dir.isDirectory() && !dir.mkdirs())
            throw new IOException("Media directory unavailable");
        String safeName = PublicMediaWritePolicy.fileName(name);
        File reserved = null;
        for (int suffix = 0; suffix < 10000; suffix++) {
            File candidate = new File(dir,
                    suffix == 0 ? safeName : suffix + "_" + safeName);
            if (candidate.createNewFile()) {
                reserved = candidate;
                break;
            }
        }
        if (reserved == null) throw new IOException("No available media filename");
        File staged = null;
        boolean committed = false;
        try {
            staged = File.createTempFile(".nova-incomplete-", ".tmp", dir);
            try (FileOutputStream out = new FileOutputStream(staged)) {
                copy(media, out);
                out.getFD().sync();
            }
            if (!staged.renameTo(reserved)) throw new IOException("Media rename failed");
            committed = true;
            return reserved;
        } finally {
            if (staged != null && staged.exists()) staged.delete();
            if (!committed) reserved.delete();
        }
    }
}
