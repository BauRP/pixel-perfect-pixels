package app.lovable.privacygallery;

import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Pure URI tests: never open or share personal images during CI. */
@RunWith(AndroidJUnit4.class)
public class MediaSharePolicyTest {
    @Test public void acceptsRealMediaStorePhotoAndVideo() {
        assertTrue(MediaSharePolicy.isPublicMediaUri(
                Uri.parse("content://media/external/images/media/123")));
        assertTrue(MediaSharePolicy.isPublicMediaUri(
                Uri.parse("content://media/external_primary/video/media/456")));
    }
    @Test public void rejectsPrivateOrMalformedSources() {
        for (String value : new String[] {
                "file:///storage/emulated/0/DCIM/a.jpg",
                "content://private.example/files/10",
                "content://media/external/images/media/str",
                "content://media/external/images/media/../123",
                "content://media/external/file/123",
                "https://example.com/photo",
                "content://media/external/images/media/10/extra",
                "content://media/external/images/media/1?foo=bar",
                "content://media/external/images/media/1#fragment",
                "content://media/internal/images/media/123",
                "content://media/external/video/media/0"
        }) assertFalse(value, MediaSharePolicy.isPublicMediaUri(Uri.parse(value)));
    }
    @Test public void choosesSpecificAndroidMimeForHomogeneousAlbums() {
        assertEquals("image/*", MediaSharePolicy.chooserMime("image/*"));
        assertEquals("video/*", MediaSharePolicy.chooserMime("video/*"));
        assertEquals("*/*", MediaSharePolicy.chooserMime("*/*"));
        assertEquals("*/*", MediaSharePolicy.chooserMime("text/plain"));
        assertEquals("*/*", MediaSharePolicy.chooserMime(null));
    }
}

