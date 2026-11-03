import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.Files;
import javax.imageio.ImageIO;

/** Deterministic CI regression tests for the real screenshot checker.
 * No emulator, photographs, user data or online dependency required. */
public final class ValidateScreenshotSelfTest {
    private static int count = 0;
    private static void check(File file, boolean shouldPass) throws Exception {
        boolean passed;
        try {
            ValidateScreenshot.main(new String[] {file.getAbsolutePath()});
            passed = true;
        } catch (IllegalStateException expected) {
            passed = false;
        }
        if (passed != shouldPass) {
            throw new AssertionError("Screenshot classifier unexpected result for " + file
                    + ": expected=" + shouldPass + " actual=" + passed);
        }
        count++;
    }
    private static File save(File directory, String name, BufferedImage image) throws Exception {
        File out = new File(directory, name + ".png");
        if (!ImageIO.write(image, "png", out)) throw new AssertionError("PNG encoder missing");
        return out;
    }
    public static void main(String[] args) throws Exception {
        File dir = Files.createTempDirectory("nova-screenshot-classifier-").toFile();
        try {
            int[][] viewports = {{1080, 1920}, {320, 480}, {1024, 600}, {780, 360}};
            for (int[] size : viewports) {
                int width = size[0], height = size[1];
                BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
                Graphics2D g = image.createGraphics();
                try {
                    g.setColor(Color.BLACK);
                    g.fillRect(0, 0, width, height);
                    g.setColor(Color.WHITE);
                    g.fillRect(0, height - Math.max(6, height / 40), width, height / 40);
                    check(save(dir, "black-nav-" + width, image), false);
                    g.setColor(Color.WHITE);
                    g.fillRect(0, 0, width, height);
                    g.setColor(Color.BLACK);
                    g.fillRect(0, height - Math.max(6, height / 40), width, height / 40);
                    check(save(dir, "white-nav-" + width, image), false);
                    g.setColor(new Color(15, 17, 22));
                    g.fillRect(0, 0, width, height);
                    g.setColor(Color.WHITE);
                    g.fillRect(width / 10, height / 10, width * 4 / 5, Math.max(40, height / 10));
                    g.fillRect(width / 10, height * 7 / 10, width * 4 / 5, Math.max(40, height / 12));
                    check(save(dir, "dark-ui-" + width, image), true);
                    g.setColor(Color.WHITE);
                    g.fillRect(0, 0, width, height);
                    g.setColor(new Color(15, 17, 22));
                    g.fillRect(width / 10, height / 10, width * 4 / 5, Math.max(40, height / 10));
                    g.fillRect(width / 10, height * 7 / 10, width * 4 / 5, Math.max(40, height / 12));
                    check(save(dir, "light-ui-" + width, image), true);
                } finally {
                    g.dispose();
                    image.flush();
                }
            }
            System.out.println("Nova screenshot classifier: " + count + " regression cases passed.");
        } finally {
            File[] entries = dir.listFiles();
            if (entries != null) for (File e : entries) Files.deleteIfExists(e.toPath());
            Files.deleteIfExists(dir.toPath());
        }
    }
}
