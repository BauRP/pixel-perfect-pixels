package app.lovable.privacygallery;

import android.net.Uri;
import java.util.List;

/** A share-album intent may reference public MediaStore photo/video rows only. */
final class MediaSharePolicy {
    private MediaSharePolicy() {}

    static boolean isPublicMediaUri(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme())
                || !"media".equals(uri.getAuthority())) return false;
        List<String> segments = uri.getPathSegments();
        if (segments.size() != 4 ||
                !("images".equals(segments.get(1)) || "video".equals(segments.get(1))) ||
                !"media".equals(segments.get(2))) return false;
        String id = segments.get(3);
        if (id.isEmpty()) return false;
        for (int i = 0; i < id.length(); i++)
            if (id.charAt(i) < '0' || id.charAt(i) > '9') return false;
        return true;
    }
}
