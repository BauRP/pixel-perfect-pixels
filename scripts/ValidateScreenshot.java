import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * CI-only validation of REAL Android emulator screenshots. Does not read
 * user photographs. A running process or a permission dialog is not proof
 * the gallery actually rendered on a small/rotated/gesture viewport.
 *
 * Source-file execution uses the JDK supplied by actions/setup-java.
 * No Python imaging packages or external network dependencies are required.
 */
public final class ValidateScreenshot {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("expected screenshot PNG path");
        BufferedImage image = ImageIO.read(new File(args[0]));
        if (image == null || image.getWidth() < 100 || image.getHeight() < 100)
            throw new IllegalStateException("missing/unreadable screenshot: " + args[0]);
        int width = image.getWidth(), height = image.getHeight();
        int xStart = Math.max(0, width / 20), xEnd = width - xStart;
        // Exclude top OS clock/icons and bottom OS gesture/three-button area.
        // Android 13's completely black landscape screen had a white gesture
        // strip that a naive nonblack-pixel test incorrectly called "UI".
        int yStart = Math.max(0, height / 20);
        int yEnd = Math.max(yStart + 1, height * 87 / 100);
        int samples = 0, visible = 0, dark = 0;
        for (int y = yStart; y < yEnd; y += 3) {
            for (int x = xStart; x < xEnd; x += 3) {
                int rgb = image.getRGB(x, y);
                int r = (rgb >>> 16) & 255, g = (rgb >>> 8) & 255, b = rgb & 255;
                samples++;
                if (Math.max(r, Math.max(g, b)) >= 105) visible++;
                if (Math.max(r, Math.max(g, b)) <= 50) dark++;
            }
        }
        int minimum = Math.max(18, samples / 4000);
        System.out.println("Screenshot " + args[0] + " " + width + "x" + height +
                " visible=" + visible + "/" + samples +
                " dark=" + dark + "/" + samples + " minimum=" + minimum);
        if (visible < minimum || dark < minimum)
            throw new IllegalStateException(
                "App looks like a blank/solid-black/solid-white window rather than a gallery");
    }
}
