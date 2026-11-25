package app.lovable.privacygallery;

/** A single Android permission dialog owns a single outstanding PluginCall.
 * Other requests are answered with the current state, without interrupting
 * the original pending permission callback. */
public final class MediaPermissionDialogPolicy {
    private MediaPermissionDialogPolicy() {}

    static boolean shouldLaunchDialog(String state, boolean reselect,
                                      boolean anotherDialogPending, boolean activityExists) {
        if (!activityExists || anotherDialogPending) return false;
        if ("granted".equals(state)) return false;
        if ("partial".equals(state) && !reselect) return false;
        return true;
    }
}
