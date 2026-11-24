package app.lovable.privacygallery;

import android.database.Cursor;

/** Treat an unavailable MediaStore query as unknown, never as evidence that
 * a public photo was actually deleted or that a whole album is empty. */
final class MediaStoreCursorPolicy {
    private MediaStoreCursorPolicy() {}

    static boolean isPresentOrUnknown(Cursor cursor) {
        return cursor == null || cursor.moveToFirst();
    }

    /** OEM MediaStore providers may omit MIME even for real image/video rows. */
    static String mimeOrEmpty(String mime) {
        return mime == null ? "" : mime;
    }
}
