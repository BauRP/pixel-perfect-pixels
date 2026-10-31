package app.lovable.privacygallery;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.app.WallpaperManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.ContentUris;
import android.content.Intent;
import android.content.IntentSender;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import android.Manifest;
import android.content.pm.PackageManager;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Nova Gallery — SecureVault native bridge.
 *
 * Responsibilities:
 *  1. Enforce a private, non-indexable vault directory inside the app's
 *     internal storage (filesDir/nova_vault) guarded by a .nomedia marker.
 *  2. Permanently delete the ORIGINAL media from public storage after the
 *     encrypted copy has been written into the vault, so the file vanishes
 *     from the system gallery and from every third-party file manager.
 *
 * Deletion strategy (per Android version):
 *  • API <= 29  → direct File.delete() + MediaStore row removal.
 *  • API >= 30  → MediaStore row removal; if the OS denies ownership the
 *                 uris are batched into MediaStore.createDeleteRequest()
 *                 and confirmed by the user in a single system dialog.
 *                 With MANAGE_EXTERNAL_STORAGE granted the direct path is
 *                 used and no dialog appears at all.
 */
@CapacitorPlugin(name = "SecureVault")
public class SecureVaultPlugin extends Plugin {

    // ── Runtime media permission (READ_MEDIA_* / READ_EXTERNAL_STORAGE) ─────
    public static final int MEDIA_PERM_REQUEST_CODE = 4917;
    private static PluginCall pendingMediaCall = null;

    public static final int DELETE_REQUEST_CODE = 7311;
    private static final String VAULT_DIR = "nova_vault";

    private static SecureVaultPlugin instance = null;
    private PluginCall pendingDeleteCall;
    private List<String> pendingDeletePaths;
    private List<Uri> pendingDeleteUris;
    private List<String> pendingAlreadyDeleted;

    @Override
    public void load() {
        super.load();
        instance = this;
        ensureVaultDir();
    }

    private static String[] mediaPermissions() {
        if (Build.VERSION.SDK_INT >= 34) {
            return new String[] {
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
            };
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return new String[] { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO };
        }
        return new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
    }

    /** "granted" | "partial" (Android 14 selected photos) | "denied" | "prompt". */
    private String mediaPermissionState() {
        Activity a = getActivity();
        // READ_MEDIA_VISUAL_USER_SELECTED is a separate partial-access state,
        // not a requirement when the user has granted all images and videos.
        boolean images = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_MEDIA_IMAGES)
                == PackageManager.PERMISSION_GRANTED;
        boolean videos = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_MEDIA_VIDEO)
                == PackageManager.PERMISSION_GRANTED;
        if (Build.VERSION.SDK_INT >= 33 && images && videos) return "granted";
        if (Build.VERSION.SDK_INT >= 33 && (images || videos)) return "partial";
        if (Build.VERSION.SDK_INT < 33 &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED) return "granted";
        if (Build.VERSION.SDK_INT >= 34 && ContextCompat.checkSelfPermission(getContext(),
                "android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == PackageManager.PERMISSION_GRANTED) {
            return "partial";
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) return "granted";
        boolean asked = getContext().getSharedPreferences("nova_perm", 0).getBoolean("media_asked", false);
        if (!asked) return "prompt";
        if (a != null) {
            for (String p : mediaPermissions()) {
                if (ActivityCompat.shouldShowRequestPermissionRationale(a, p)) return "prompt";
            }
        }
        return "denied";
    }

    @PluginMethod
    public void checkMediaPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", mediaPermissionState());
        call.resolve(r);
    }

    @PluginMethod
    public void requestMediaPermission(PluginCall call) {
        String st = mediaPermissionState();
        Activity a = getActivity();
        boolean reselect = call.getBoolean("reselect", false);
        if ("granted".equals(st) || ("partial".equals(st) && !reselect) || a == null) {
            JSObject r = new JSObject();
            r.put("state", st);
            call.resolve(r);
            return;
        }
        if (pendingMediaCall != null) {
            // Coalesce: a dialog is already up; resolve the older call with the current state.
            JSObject r = new JSObject();
            r.put("state", st);
            pendingMediaCall.resolve(r);
        }
        pendingMediaCall = call;
        getContext().getSharedPreferences("nova_perm", 0).edit().putBoolean("media_asked", true).apply();
        Log.i("GalleryScan", "requesting media permission");
        ActivityCompat.requestPermissions(a, mediaPermissions(), MEDIA_PERM_REQUEST_CODE);
    }

    /** Called from MainActivity.onRequestPermissionsResult. */
    public static void onMediaPermissionResult() {
        PluginCall c = pendingMediaCall;
        pendingMediaCall = null;
        if (c == null || instance == null) return;
        JSObject r = new JSObject();
        String st = instance.mediaPermissionState();
        Log.i("GalleryScan", "media permission result: " + st);
        r.put("state", st);
        c.resolve(r);
    }

    // Read shared media by MediaStore content URIs: works with scoped storage.
    @PluginMethod
    public void getMediaItems(PluginCall call) {
        new Thread(() -> {
            JSArray items = new JSArray();
            boolean modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
            Uri collection = MediaStore.Files.getContentUri("external");
            String[] projection = modern
                ? new String[] { MediaStore.Files.FileColumns._ID,
                    MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE,
                    MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED,
                    MediaStore.MediaColumns.RELATIVE_PATH }
                : new String[] { MediaStore.Files.FileColumns._ID,
                    MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE,
                    MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED,
                    MediaStore.MediaColumns.DATA };
            String filter = MediaStore.Files.FileColumns.MEDIA_TYPE + "=? OR "
                + MediaStore.Files.FileColumns.MEDIA_TYPE + "=?";
            String[] args = { Integer.toString(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE),
                              Integer.toString(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO) };
            try (Cursor cursor = getContext().getContentResolver().query(
                    collection, projection, filter, args,
                    MediaStore.MediaColumns.DATE_MODIFIED + " DESC")) {
                if (cursor != null) while (cursor.moveToNext()) {
                    String name = cursor.getString(1);
                    String mime = cursor.getString(2);
                    if (name == null || mime == null) continue;
                    String directory = cursor.getString(5);
                    if (!modern) {
                        File f = directory == null ? null : new File(directory);
                        directory = f == null || f.getParent() == null ? "" : f.getParent();
                        String root = Environment.getExternalStorageDirectory().getAbsolutePath();
                        if (directory.startsWith(root + "/"))
                            directory = directory.substring(root.length() + 1);
                    }
                    JSObject obj = new JSObject();
                    obj.put("uri", ContentUris.withAppendedId(collection, cursor.getLong(0)).toString());
                    obj.put("name", name);
                    obj.put("mime", mime);
                    obj.put("size", Math.max(0L, cursor.getLong(3)));
                    obj.put("mtime", Math.max(0L, cursor.getLong(4)) * 1000L);
                    obj.put("relativePath", directory == null ? "" : directory);
                    items.put(obj);
                }
                JSObject result = new JSObject();
                result.put("items", items);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("MediaStore scan failed: " + error.getMessage());
            }
        }, "nova-media-scan").start();
    }

    // ── private directory enforcement ────────────────────────────────────
    private File ensureVaultDir() {
        File dir = new File(getContext().getFilesDir(), VAULT_DIR);
        if (!dir.exists()) dir.mkdirs();
        File nomedia = new File(dir, ".nomedia");
        if (!nomedia.exists()) {
            try (FileOutputStream fos = new FileOutputStream(nomedia)) {
                fos.write(0);
            } catch (IOException ignored) {}
        }
        return dir;
    }

    @PluginMethod
    public void ensurePrivateDir(PluginCall call) {
        File dir = ensureVaultDir();
        JSObject ret = new JSObject();
        ret.put("path", dir.getAbsolutePath());
        ret.put("nomedia", new File(dir, ".nomedia").exists());
        call.resolve(ret);
    }

    // ── all-files access (needed to hard-delete originals silently) ──────
    @PluginMethod
    public void hasAllFilesAccess(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", allFilesAccess());
        call.resolve(ret);
    }

    private boolean allFilesAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return true;
    }

    @PluginMethod
    public void requestAllFilesAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || allFilesAccess()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        } catch (Exception e) {
            try {
                getActivity().startActivity(
                        new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            } catch (Exception ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("granted", false);
        call.resolve(ret);
    }

    // ── delete originals from public storage ─────────────────────────────
    /**
     * Never mistake a content:// URI for a filesystem path.
     * Android 11+: use MediaStore.createDeleteRequest for unowned media.
     * Android 10: use RecoverableSecurityException's system confirmation.
     * Android 7-9: delete with the legacy storage permission.
     */
    @PluginMethod
    public void deleteOriginals(PluginCall call) {
        JSArray input = call.getArray("paths");
        if (input == null) {
            call.reject("paths is required");
            return;
        }
        List<String> paths;
        try {
            paths = input.toList();
        } catch (org.json.JSONException e) {
            call.reject("invalid paths");
            return;
        }

        List<String> deleted = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        List<Uri> confirmUris = new ArrayList<>();
        List<String> confirmPaths = new ArrayList<>();
        PendingIntent android10Permission = null;
        ContentResolver resolver = getContext().getContentResolver();

        for (String original : paths) {
            if (original == null || original.length() == 0) continue;
            // The same raw content URI is returned in the result so JS can
            // remove exactly the file that the system confirmed deleting.
            Uri uri = original.startsWith("content://")
                    ? Uri.parse(original) : findMediaUri(normalize(original));
            if (uri == null) {
                if (Build.VERSION.SDK_INT <= 28) {
                    File file = new File(normalize(original));
                    if (file.exists() && file.delete()) {
                        deleted.add(original);
                    } else {
                        failed.add(original);
                    }
                } else {
                    failed.add(original);
                }
                continue;
            }
            try {
                if (resolver.delete(uri, null, null) > 0) {
                    deleted.add(original);
                } else if (!mediaExists(uri)) {
                    deleted.add(original);
                } else {
                    confirmUris.add(uri);
                    confirmPaths.add(original);
                }
            } catch (SecurityException security) {
                if (Build.VERSION.SDK_INT == 29 &&
                        security instanceof RecoverableSecurityException) {
                    if (android10Permission == null) {
                        android10Permission =
                                ((RecoverableSecurityException) security).getUserAction().getActionIntent();
                        confirmUris.add(uri);
                        confirmPaths.add(original);
                    } else {
                        // Android 10 requires one consent at a time.
                        failed.add(original);
                    }
                } else if (Build.VERSION.SDK_INT >= 30) {
                    confirmUris.add(uri);
                    confirmPaths.add(original);
                } else {
                    failed.add(original);
                }
            } catch (Exception error) {
                Log.w("GalleryDelete", "Could not delete " + original, error);
                failed.add(original);
            }
        }

        if (!confirmUris.isEmpty() && Build.VERSION.SDK_INT >= 29) {
            try {
                PendingIntent request = Build.VERSION.SDK_INT == 29
                        ? android10Permission
                        : MediaStore.createDeleteRequest(resolver, confirmUris);
                if (request != null) {
                    pendingDeleteCall = call;
                    pendingDeletePaths = confirmPaths;
                    pendingDeleteUris = confirmUris;
                    pendingAlreadyDeleted = deleted;
                    // Keep non-confirmable items in the result after user choice.
                    pendingFailedPaths = failed;
                    call.setKeepAlive(true);
                    getActivity().startIntentSenderForResult(
                            request.getIntentSender(), DELETE_REQUEST_CODE,
                            null, 0, 0, 0);
                    return;
                }
            } catch (IntentSender.SendIntentException | RuntimeException error) {
                Log.e("GalleryDelete", "System delete dialog failed", error);
            }
            failed.addAll(confirmPaths);
        }
        resolveDelete(call, deleted, failed);
    }

    private List<String> pendingFailedPaths;

    private boolean mediaExists(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[] { MediaStore.MediaColumns._ID }, null, null, null)) {
            return cursor != null && cursor.moveToFirst();
        } catch (Exception error) {
            // Inaccessible is not proof of deletion: avoid a false success.
            return true;
        }
    }

    private void resolveDelete(PluginCall call, List<String> deleted, List<String> failed) {
        JSObject ret = new JSObject();
        ret.put("deleted", JSArray.from(deleted.toArray(new String[0])));
        ret.put("failed", JSArray.from(failed.toArray(new String[0])));
        call.resolve(ret);
    }

    /** Called after the OS confirmation screen closes. */
    public static void onDeleteRequestResult(int resultCode) {
        SecureVaultPlugin plugin = instance;
        if (plugin == null || plugin.pendingDeleteCall == null) return;
        PluginCall call = plugin.pendingDeleteCall;
        List<String> deleted = plugin.pendingAlreadyDeleted != null
                ? plugin.pendingAlreadyDeleted : new ArrayList<>();
        List<String> failed = plugin.pendingFailedPaths != null
                ? plugin.pendingFailedPaths : new ArrayList<>();
        List<String> paths = plugin.pendingDeletePaths;
        List<Uri> uris = plugin.pendingDeleteUris;
        plugin.pendingDeleteCall = null;
        plugin.pendingAlreadyDeleted = null;
        plugin.pendingFailedPaths = null;
        plugin.pendingDeletePaths = null;
        plugin.pendingDeleteUris = null;

        if (paths != null && uris != null) {
            for (int i = 0; i < paths.size(); i++) {
                boolean removed = !plugin.mediaExists(uris.get(i));
                if (Build.VERSION.SDK_INT == 29 &&
                        resultCode == Activity.RESULT_OK && !removed) {
                    // The Android 10 prompt grants one operation; actually
                    // execute it after obtaining consent before reporting success.
                    try {
                        removed = plugin.getContext().getContentResolver()
                                .delete(uris.get(i), null, null) > 0;
                    } catch (Exception ignored) {
                        removed = false;
                    }
                }
                if (removed) deleted.add(paths.get(i));
                else failed.add(paths.get(i));
            }
        }
        call.setKeepAlive(false);
        plugin.resolveDelete(call, deleted, failed);
    }

    // ── helpers ──────────────────────────────────────────────────────────
    private String normalize(String raw) {
        if (raw.startsWith("file://")) return Uri.parse(raw).getPath();
        if (raw.startsWith("content://")) {
            String p = pathFromContentUri(Uri.parse(raw));
            return p != null ? p : raw;
        }
        return raw;
    }

    private String pathFromContentUri(Uri uri) {
        ContentResolver cr = getContext().getContentResolver();
        try (Cursor c = cr.query(uri, new String[]{MediaStore.MediaColumns.DATA},
                null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return null;
    }

    private Uri findMediaUri(String absPath) {
        ContentResolver cr = getContext().getContentResolver();
        Uri collection = MediaStore.Files.getContentUri("external");
        try (Cursor c = cr.query(collection,
                new String[]{MediaStore.MediaColumns._ID},
                MediaStore.MediaColumns.DATA + "=?",
                new String[]{absPath}, null)) {
            if (c != null && c.moveToFirst()) {
                return ContentUris.withAppendedId(collection, c.getLong(0));
            }
        } catch (Exception ignored) {}
        return null;
    }

    // ── set as wallpaper ─────────────────────────────────────────────────
    /**
     * Sets the given image as the device wallpaper.
     * Accepts either { path } (file://, content:// or absolute path) or
     * { base64 } raw image bytes (used for edited images).
     */
    @PluginMethod
    public void setWallpaper(PluginCall call) {
        String path = call.getString("path");
        String base64 = call.getString("base64");
        String target = call.getString("target", "both");
        // Decoding a full-resolution photo and handing it to WallpaperManager
        // can take seconds. Doing that on the WebView/UI thread freezes the
        // app, so the whole operation runs on a worker thread.
        new Thread(() -> {
            try {
                Bitmap bmp = null;
                if (base64 != null && base64.length() > 0) {
                    byte[] bytes = Base64.decode(stripDataUrl(base64), Base64.DEFAULT);
                    bmp = decodeSampled(bytes, null);
                } else if (path != null && path.length() > 0) {
                    bmp = decodeAny(path);
                }
                if (bmp == null) {
                    call.reject("Image could not be decoded");
                    return;
                }
                WallpaperManager wm = WallpaperManager.getInstance(getContext());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    int flags = WallpaperManager.FLAG_SYSTEM | WallpaperManager.FLAG_LOCK;
                    if ("home".equals(target)) flags = WallpaperManager.FLAG_SYSTEM;
                    else if ("lock".equals(target)) flags = WallpaperManager.FLAG_LOCK;
                    wm.setBitmap(bmp, null, true, flags);
                } else {
                    wm.setBitmap(bmp);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Throwable e) {
                call.reject("Wallpaper failed: " + e.getMessage());
            }
        }).start();
    }

    private String stripDataUrl(String s) {
        int i = s.indexOf("base64,");
        return i >= 0 ? s.substring(i + 7) : s;
    }

    private Bitmap decodeAny(String raw) {
        try {
            if (raw.startsWith("content://")) {
                byte[] buf = readAll(Uri.parse(raw));
                return buf == null ? null : decodeSampled(buf, null);
            }
            String abs = normalize(raw);
            if (abs == null) return null;
            return decodeSampled(null, abs);
        } catch (Exception e) {
            return null;
        }
    }

    /** Max wallpaper edge — keeps decode memory bounded on huge photos. */
    private static final int MAX_WALLPAPER_EDGE = 2560;

    private Bitmap decodeSampled(byte[] bytes, String file) {
        BitmapFactory.Options probe = new BitmapFactory.Options();
        probe.inJustDecodeBounds = true;
        if (bytes != null) BitmapFactory.decodeByteArray(bytes, 0, bytes.length, probe);
        else BitmapFactory.decodeFile(file, probe);

        int sample = 1;
        int longest = Math.max(probe.outWidth, probe.outHeight);
        while (longest / sample > MAX_WALLPAPER_EDGE) sample *= 2;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return bytes != null
                ? BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts)
                : BitmapFactory.decodeFile(file, opts);
    }

    private byte[] readAll(Uri uri) {
        try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
            if (is == null) return null;
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = is.read(chunk)) > 0) bos.write(chunk, 0, n);
            return bos.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    // ── native system share sheet ────────────────────────────────────────
    /**
     * Opens the Android share sheet (ACTION_SEND) for a gallery file, or for
     * raw base64 bytes (used by the encrypted Safe, where no plaintext file
     * exists on disk). Bytes are staged in the app cache and handed out via
     * FileProvider so Telegram / WhatsApp / Drive can read them.
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String path = call.getString("path");
        String base64 = call.getString("base64");
        String name = call.getString("name", "share_" + System.currentTimeMillis());
        String mime = call.getString("mime", "*/*");
        String title = call.getString("title", "Share");
        try {
            Uri uri;
            if (base64 != null && base64.length() > 0) {
                byte[] bytes = Base64.decode(stripDataUrl(base64), Base64.DEFAULT);
                File out = stageCacheFile(sanitize(name));
                try (FileOutputStream fos = new FileOutputStream(out)) { fos.write(bytes); }
                uri = providerUri(out);
            } else if (path != null && path.startsWith("content://")) {
                uri = Uri.parse(path);
            } else if (path != null && path.length() > 0) {
                String abs = normalize(path);
                File src = abs == null ? null : new File(abs);
                if (src == null || !src.exists()) { call.reject("File not found"); return; }
                File out = stageCacheFile(sanitize(src.getName()));
                copyFile(src, out);
                uri = providerUri(out);
            } else {
                call.reject("path or base64 is required");
                return;
            }

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Share failed: " + e.getMessage());
        }
    }

    private String sanitize(String n) {
        return n.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private File stageCacheFile(String name) {
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, name);
    }

    private Uri providerUri(File f) {
        return FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", f);
    }

    private void copyFile(File src, File dst) throws IOException {
        try (FileInputStream in = new FileInputStream(src);
             FileOutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    // ── restore a decrypted Safe file back to public storage ─────────────
    /**
     * Writes decrypted bytes back into the user's public media collection at
     * the original relative folder (e.g. "DCIM/Camera") and re-registers the
     * file with the MediaStore, so it becomes visible again to the gallery
     * and to every other app.
     */
    @PluginMethod
    public void restoreFile(PluginCall call) {
        String base64 = call.getString("base64");
        String name = call.getString("name", "restored_" + System.currentTimeMillis());
        String mime = call.getString("mime", "image/jpeg");
        String relative = call.getString("relativePath", "");
        if (base64 == null || base64.length() == 0) {
            call.reject("base64 is required");
            return;
        }
        if (relative == null || relative.trim().length() == 0) {
            relative = mime.startsWith("video/")
                    ? Environment.DIRECTORY_MOVIES
                    : Environment.DIRECTORY_PICTURES;
        }
        relative = relative.replaceAll("^/+", "").replaceAll("/+$", "");

        byte[] bytes;
        try {
            bytes = Base64.decode(stripDataUrl(base64), Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("invalid base64");
            return;
        }

        try {
            String savedPath;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, sanitize(name));
                cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, relative);
                Uri collection = mime.startsWith("video/")
                        ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                Uri uri = getContext().getContentResolver().insert(collection, cv);
                if (uri == null) { call.reject("insert failed"); return; }
                try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                    if (os == null) { call.reject("open failed"); return; }
                    os.write(bytes);
                }
                savedPath = uri.toString();
            } else {
                File dir = new File(Environment.getExternalStorageDirectory(), relative);
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, sanitize(name));
                try (FileOutputStream fos = new FileOutputStream(out)) { fos.write(bytes); }
                savedPath = out.getAbsolutePath();
                Intent scan = new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE);
                scan.setData(Uri.fromFile(out));
                getContext().sendBroadcast(scan);
            }
            JSObject ret = new JSObject();
            ret.put("path", savedPath);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("restore failed: " + e.getMessage());
        }
    }

    // ── save an edited image back to public storage ──────────────────────
    /**
     * Persists an edited JPEG/PNG (base64) into Pictures/NovaGallery and
     * registers it with the MediaStore so it shows up in the gallery.
     */
    @PluginMethod
    public void saveImage(PluginCall call) {
        String base64 = call.getString("base64");
        String name = call.getString("name", "nova_edit_" + System.currentTimeMillis() + ".jpg");
        String mime = call.getString("mime", "image/jpeg");
        if (base64 == null || base64.length() == 0) {
            call.reject("base64 is required");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(stripDataUrl(base64), Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("invalid base64");
            return;
        }
        try {
            String savedPath;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/NovaGallery");
                Uri uri = getContext().getContentResolver()
                        .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) { call.reject("insert failed"); return; }
                try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                    if (os == null) { call.reject("open failed"); return; }
                    os.write(bytes);
                }
                savedPath = uri.toString();
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_PICTURES), "NovaGallery");
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, name);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(bytes);
                }
                savedPath = out.getAbsolutePath();
                Intent scan = new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE);
                scan.setData(Uri.fromFile(out));
                getContext().sendBroadcast(scan);
            }
            JSObject ret = new JSObject();
            ret.put("path", savedPath);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }
}
