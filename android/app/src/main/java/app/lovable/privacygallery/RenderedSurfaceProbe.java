package app.lovable.privacygallery;

import android.graphics.Bitmap;

/**
 * Conservative in-memory paint check. Merely having a successful WebView JS
 * callback is not proof that Android has displayed gallery controls.
 * Sample the central display, excluding OS status and navigation controls.
 */
public final class RenderedSurfaceProbe {
    private RenderedSurfaceProbe() {}

    public static boolean hasUiContrast(Bitmap bitmap) {
        if (bitmap == null || bitmap.isRecycled()) return false;
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        if (width < 100 || height < 100) return false;
        int x0 = width / 20, x1 = width - x0;
        int y0 = height / 20, y1 = height * 87 / 100;
        int light = 0, dark = 0, samples = 0;
        for (int y = y0; y < y1; y += 3) {
            for (int x = x0; x < x1; x += 3) {
                int color = bitmap.getPixel(x, y);
                int red = (color >>> 16) & 255;
                int green = (color >>> 8) & 255;
                int blue = color & 255;
                int peak = Math.max(red, Math.max(green, blue));
                if (peak >= 105) light++;
                if (peak <= 50) dark++;
                samples++;
            }
        }
        int minimum = Math.max(18, samples / 4000);
        return light >= minimum && dark >= minimum;
    }
}
