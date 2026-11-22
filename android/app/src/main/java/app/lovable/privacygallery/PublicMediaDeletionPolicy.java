package app.lovable.privacygallery;

import android.net.Uri;
import android.os.Environment;
import java.io.File;
import java.io.IOException;
import java.util.List;

/** Only a public MediaStore image/video/file row or a legacy public file may
 * be passed to deleteOriginals. Never delete an arbitrary content provider,
 * app-private location, or traversal path returned by a malformed bridge. */
final class PublicMediaDeletionPolicy {
    private PublicMediaDeletionPolicy() {}

    static boolean isPublicMediaUri(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) ||
                !"media".equals(uri.getAuthority()) ||
                uri.getQuery() != null || uri.getFragment() != null) return false;
        List<String> s = uri.getPathSegments();
        if (s.size() != 3 && s.size() != 4) return false;
        if (!("external".equals(s.get(0)) ||
                s.get(0).startsWith("external_"))) return false;
        if (s.size() == 3 && !"file".equals(s.get(1))) return false;
        if (s.size() == 4 &&
                (!(("images".equals(s.get(1)) || "video".equals(s.get(1)))) ||
                !"media".equals(s.get(2)))) return false;
        String id = s.get(s.size() - 1);
        if (id.isEmpty() || "0".equals(id)) return false;
        for (int i = 0; i < id.length(); i++)
            if (id.charAt(i) < '0' || id.charAt(i) > '9') return false;
        return true;
    }

    static boolean isPublicLegacyFile(String path) {
        if (path == null || !path.startsWith("/") || path.indexOf('\0') >= 0)
            return false;
        try {
            String root = Environment.getExternalStorageDirectory().getCanonicalPath();
            String file = new File(path).getCanonicalPath();
            if (!file.startsWith(root + "/")) return false;
            String relative = file.substring(root.length() + 1);
            if (relative.startsWith("Android/data/") ||
                    relative.startsWith("Android/obb/") ||
                    relative.startsWith("Android/media/")) return false;
            return true;
        } catch (IOException ignored) {
            return false;
        }
    }
}
