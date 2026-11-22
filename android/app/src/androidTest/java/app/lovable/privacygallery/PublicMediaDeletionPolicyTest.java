package app.lovable.privacygallery;

import android.net.Uri;
import android.os.Environment;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import static org.junit.Assert.*;

/** Does not create or delete user media. Input validation only. */
@RunWith(AndroidJUnit4.class)
public class PublicMediaDeletionPolicyTest {
    @Test public void acceptsActualPublicPhotoVideoAndFileIds() {
        assertTrue(PublicMediaDeletionPolicy.isPublicMediaUri(
                Uri.parse("content://media/external/file/123")));
        assertTrue(PublicMediaDeletionPolicy.isPublicMediaUri(
                Uri.parse("content://media/external/images/media/7")));
        assertTrue(PublicMediaDeletionPolicy.isPublicMediaUri(
                Uri.parse("content://media/external_primary/video/media/98")));
    }

    @Test public void rejectsPrivateProvidersMalformedIdsAndQueryParameters() {
        for (String address : new String[] {
                "content://private.app/files/1",
                "content://media/external/file/../1",
                "content://media/external/file/not-id",
                "content://media/external/file/1?delete=true",
                "content://media/internal/file/8",
                "content://media/external/file/0",
                "content://media/external/images/media/1/extra",
                "content://media/external/downloads/9",
                "file:///storage/emulated/0/photo.jpg"
        }) assertFalse(address, PublicMediaDeletionPolicy.isPublicMediaUri(Uri.parse(address)));
    }

    @Test public void permitsLegacyPublicPhotosButNeverPrivateOrTraversalPaths() {
        String root = Environment.getExternalStorageDirectory().getAbsolutePath();
        assertTrue(PublicMediaDeletionPolicy.isPublicLegacyFile(
                root + "/DCIM/Camera/photo.jpg"));
        for (String invalid : new String[] {
                "/data/user/0/app.lovable.privacygallery/files/private.enc",
                "/data/local/tmp/nova-ci.jpg",
                root + "/DCIM/../../private.key",
                root + "/Android/data/other.app/files/private.png",
                root + "/Android/obb/other.app/private.mp4",
                "/"
        }) assertFalse(invalid, PublicMediaDeletionPolicy.isPublicLegacyFile(invalid));
    }
}
