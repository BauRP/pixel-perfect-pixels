package app.lovable.privacygallery;

/**
 * Validation for restoring encrypted photos into public media storage.
 * No Android dependencies: invalid relative paths cannot escape the
 * intended storage root on Android 7–9 or poison MediaStore on Android 10+.
 */
final class PublicMediaWritePolicy {
    private PublicMediaWritePolicy() {}

    static String fileName(String value) {
        if (value == null) return "restored_media";
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (cleaned.length() == 0 || ".".equals(cleaned) || "..".equals(cleaned))
            return "restored_media";
        return cleaned.length() <= 200 ? cleaned : cleaned.substring(0, 200);
    }

    static String relativeDirectory(String value, String mime) {
        String fallback = mime != null && mime.startsWith("video/") ? "Movies" : "Pictures";
        if (value == null || value.trim().length() == 0) return fallback;
        String path = value.trim();
        if (path.startsWith("/") || path.indexOf('\\') >= 0 ||
                path.indexOf(':') >= 0 || path.length() > 512)
            throw new IllegalArgumentException("Unsafe media directory");
        // Existing MediaStore relative paths often end with "/" — preserve
        // their original album names but prohibit any interior empty segment.
        while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        if (path.length() == 0) throw new IllegalArgumentException("Unsafe media directory");
        for (String part : path.split("/", -1)) {
            if (part.length() == 0 || part.trim().length() == 0 ||
                    ".".equals(part) || "..".equals(part))
                throw new IllegalArgumentException("Unsafe media directory");
            for (int i = 0; i < part.length(); i++)
                if (Character.isISOControl(part.charAt(i)))
                    throw new IllegalArgumentException("Unsafe media directory");
        }
        return path;
    }
}
