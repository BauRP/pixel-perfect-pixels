package app.lovable.privacygallery;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Tests without deleting or accessing anyone's photos. */
@RunWith(AndroidJUnit4.class)
public class PublicMediaWritePolicyTest {
    @Test public void keepsMediaAlbumsAndUnicode() {
        assertEquals("DCIM/Camera", PublicMediaWritePolicy.relativeDirectory("DCIM/Camera/", "image/jpeg"));
        assertEquals("Pictures/Семья", PublicMediaWritePolicy.relativeDirectory("Pictures/Семья", "image/jpeg"));
        assertEquals("Pictures", PublicMediaWritePolicy.relativeDirectory("", "image/png"));
        assertEquals("Movies", PublicMediaWritePolicy.relativeDirectory(null, "video/mp4"));
        assertEquals("фото.jpg", PublicMediaWritePolicy.fileName("фото.jpg"));
    }

    @Test public void blocksTraversalAndAbsoluteDirectories() {
        for (String s : new String[]{"../secret", "DCIM/../../secret",
                "/storage/emulated/0", "Pictures//Camera",
                "Pictures/./Camera", "Pictures\\..\\secret",
                "C:/Windows", "Pictures/\u0000private"}) {
            try {
                PublicMediaWritePolicy.relativeDirectory(s, "image/jpeg");
                fail("Unsafe destination accepted");
            } catch (IllegalArgumentException expected) {
                // Keep the encrypted original if destination validation fails.
            }
        }
    }

    @Test public void sanitizesFilenameWithoutChangingRealNames() {
        assertEquals("private_photo.jpg", PublicMediaWritePolicy.fileName("../private/photo.jpg"));
        assertEquals("secret.jpg", PublicMediaWritePolicy.fileName("../../secret.jpg"));
        assertEquals("normal.jpg", PublicMediaWritePolicy.fileName("normal.jpg"));
        assertEquals("my_photo.png", PublicMediaWritePolicy.fileName("my/photo.png"));
        assertEquals("restored_media", PublicMediaWritePolicy.fileName(".."));
        assertEquals("restored_media", PublicMediaWritePolicy.fileName(""));
    }
}
