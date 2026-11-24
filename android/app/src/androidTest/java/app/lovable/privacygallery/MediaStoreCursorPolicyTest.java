package app.lovable.privacygallery;

import android.database.MatrixCursor;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Synthetic cursor records only; no real user's photos are opened/deleted. */
@RunWith(AndroidJUnit4.class)
public class MediaStoreCursorPolicyTest {
    @Test public void absentCursorDoesNotConfirmDeletion() {
        assertTrue(MediaStoreCursorPolicy.isPresentOrUnknown(null));
    }
    @Test public void emptyAndPopulatedCursorsHaveDifferentDeletionOutcomes() {
        try (MatrixCursor cursor = new MatrixCursor(new String[] { "_id" })) {
            assertFalse(MediaStoreCursorPolicy.isPresentOrUnknown(cursor));
        }
        try (MatrixCursor cursor = new MatrixCursor(new String[] { "_id" })) {
            cursor.addRow(new Object[] { 17L });
            assertTrue(MediaStoreCursorPolicy.isPresentOrUnknown(cursor));
        }
    }
    @Test public void missingMimeRetainsValidProviderRow() {
        assertEquals("", MediaStoreCursorPolicy.mimeOrEmpty(null));
        assertEquals("image/heic", MediaStoreCursorPolicy.mimeOrEmpty("image/heic"));
    }
}
