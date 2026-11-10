package app.lovable.privacygallery;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;

/**
 * Private, per-share staging for decrypted Safe files and public media copies.
 * Never keep complete decoded media in a Java byte[] or overwrite another
 * share with the same filename. Share grants are read-only and time-limited
 * by the receiving application; stale cache files are removed on next launch.
 */
final class PrivateShareStaging {
    private PrivateShareStaging() {}

    static final long RETAIN_MILLIS = 24L * 60L * 60L * 1000L;
    private static final String PREFIX = "nova-";

    static File stageBase64(File cacheRoot, String name, String encoded) throws IOException {
        try (InputStream media = PublicMediaStreams.fromBase64(encoded)) {
            return stage(cacheRoot, name, media);
        }
    }

    static File stageFile(File cacheRoot, String name, File source) throws IOException {
        try (InputStream media = new FileInputStream(source)) {
            return stage(cacheRoot, name, media);
        }
    }

    private static File stage(File cacheRoot, String name, InputStream media)
            throws IOException {
        File parent = new File(cacheRoot, "shared");
        if (!parent.isDirectory() && !parent.mkdirs())
            throw new IOException("Private share cache unavailable");
        File folder = null;
        for (int attempt = 0; attempt < 5; attempt++) {
            File candidate = new File(parent, PREFIX + UUID.randomUUID());
            if (candidate.mkdir()) {
                folder = candidate;
                break;
            }
        }
        if (folder == null) throw new IOException("Private share folder unavailable");
        File output = new File(folder, PublicMediaWritePolicy.fileName(name));
        boolean complete = false;
        try {
            try (FileOutputStream out = new FileOutputStream(output)) {
                PublicMediaStreams.copy(media, out);
                out.getFD().sync();
            }
            complete = true;
            return output;
        } finally {
            if (!complete) discard(output);
        }
    }

    /** Discard only a copy this helper staged, including a failed write. */
    static void discard(File staged) {
        if (staged == null) return;
        File folder = staged.getParentFile();
        if (folder == null || !folder.getName().startsWith(PREFIX)) return;
        File parent = folder.getParentFile();
        if (parent == null || !"shared".equals(parent.getName())) return;
        staged.delete();
        folder.delete();
    }

    /**
     * Do not delete recent files: a receiving app may still be reading a URI
     * after the share sheet has closed. Also clear the flat cache files left
     * by previous app versions, but never touch the encrypted nova_vault.
     */
    static void cleanupExpired(File cacheRoot, long now) {
        File parent = new File(cacheRoot, "shared");
        File[] entries = parent.listFiles();
        if (entries == null) return;
        for (File entry : entries) {
            if (entry.lastModified() <= 0
                    || now - entry.lastModified() < RETAIN_MILLIS) continue;
            if (entry.isDirectory() && entry.getName().startsWith(PREFIX)) {
                File[] files = entry.listFiles();
                if (files == null) continue;
                for (File file : files) {
                    if (file.isFile()) file.delete();
                }
                entry.delete();
            } else if (entry.isFile()) {
                entry.delete();
            }
        }
    }
}
