package app.lovable.privacygallery;

/**
 * The native ad is a sibling of WebView in the Android view hierarchy.
 * Only the intersection of its tile with the scrollable/visible area
 * may occupy a native overlay; otherwise the layer obscures the folder
 * grid even though the React cards remain mounted underneath it.
 *
 * All coordinates are CSS pixels relative to the WebView viewport.
 * No Android dependencies: the clipping math is independently testable.
 */
final class NativeAdOverlayGeometry {
    private NativeAdOverlayGeometry() {}

    static final class Clip {
        final double left;
        final double top;
        final double width;
        final double height;
        final double adOffsetX;
        final double adOffsetY;

        Clip(double left, double top, double width, double height,
             double adOffsetX, double adOffsetY) {
            this.left = left;
            this.top = top;
            this.width = width;
            this.height = height;
            this.adOffsetX = adOffsetX;
            this.adOffsetY = adOffsetY;
        }
    }

    private static boolean finite(double value) {
        return !Double.isNaN(value) && !Double.isInfinite(value);
    }

    static Clip calculate(double x, double y, double width, double height,
                          double clipTop, double clipBottom,
                          double viewportWidth, double viewportHeight) {
        double[] values = { x, y, width, height, clipTop, clipBottom,
                            viewportWidth, viewportHeight, x + width, y + height };
        for (double value : values) {
            if (!finite(value)) return null;
        }
        if (width <= 0 || height <= 0 || viewportWidth <= 0 || viewportHeight <= 0)
            return null;

        double left = Math.max(0, x);
        double right = Math.min(viewportWidth, x + width);
        double top = Math.max(Math.max(0, clipTop), y);
        double bottom = Math.min(Math.min(viewportHeight, clipBottom), y + height);
        if (right <= left || bottom <= top) return null;

        // The native child keeps its original tile dimensions and is
        // offset within this clipped window. Never stretch an ad.
        return new Clip(left, top, right - left, bottom - top,
                        x - left, y - top);
    }
}
