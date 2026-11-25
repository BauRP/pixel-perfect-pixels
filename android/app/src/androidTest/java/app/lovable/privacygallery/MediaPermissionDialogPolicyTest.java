package app.lovable.privacygallery;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Pure permission policy; no real dialogs, accounts or user storage needed. */
@RunWith(AndroidJUnit4.class)
public class MediaPermissionDialogPolicyTest {
    @Test public void allowsOnlyOneOutstandingRequest() {
        assertTrue(MediaPermissionDialogPolicy.shouldLaunchDialog("prompt", false, false, true));
        assertFalse(MediaPermissionDialogPolicy.shouldLaunchDialog("prompt", false, true, true));
        assertFalse(MediaPermissionDialogPolicy.shouldLaunchDialog("denied", false, true, true));
    }

    @Test public void handlesPartialAccessWithoutRepeatingDialog() {
        assertFalse(MediaPermissionDialogPolicy.shouldLaunchDialog("partial", false, false, true));
        assertTrue(MediaPermissionDialogPolicy.shouldLaunchDialog("partial", true, false, true));
        assertFalse(MediaPermissionDialogPolicy.shouldLaunchDialog("partial", true, true, true));
    }

    @Test public void neverRequestsPermissionWithoutForegroundActivity() {
        assertFalse(MediaPermissionDialogPolicy.shouldLaunchDialog("prompt", false, false, false));
        assertFalse(MediaPermissionDialogPolicy.shouldLaunchDialog("granted", true, false, true));
    }
}
