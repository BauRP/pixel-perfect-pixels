package app.lovable.privacygallery;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.nativead.MediaView;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;
import com.google.android.gms.ads.nativead.NativeAdView;

/**
 * Google AdMob "Native Advanced" bridge for the first gallery tile.
 *
 * The WebView renders an empty placeholder tile; this plugin renders a real
 * NativeAdView (MediaView, headline, body, icon, call-to-action, "Ad" badge)
 * as an overlay positioned exactly over that tile. The overlay lives inside a
 * clipping frame that covers only the scrollable gallery area, so the ad
 * never draws over the sticky header or the bottom navigation.
 *
 *   loadAd({ adId })                     → loads a native ad, resolves { loaded }
 *   setBounds({ x, y, width, height,
 *               clipTop, clipBottom,
 *               visible, label, colors }) → positions/styles the overlay (CSS px)
 *   hide()                               → hides the overlay, keeps the ad
 *   destroy()                            → removes the overlay and the ad
 */
@CapacitorPlugin(name = "NativeAds")
public class NativeAdsPlugin extends Plugin {

    private static final String TAG = "NativeAds";

    private NativeAd nativeAd = null;
    private boolean loading = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ConnectivityManager.NetworkCallback netCallback = null;

    /** Fires "networkAvailable" whenever Wi-Fi or mobile data gains validated internet. */
    @Override
    public void load() {
        super.load();
        // The only Google Mobile Ads SDK initialization in the app (off the UI thread).
        final Context appCtx = getContext().getApplicationContext();
        new Thread(() -> MobileAds.initialize(appCtx, status -> Log.i(TAG, "Mobile Ads SDK ready"))).start();
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                    notifyListeners("networkAvailable", new JSObject());
                }
            }
        };
        try { cm.registerDefaultNetworkCallback(netCallback); } catch (Exception ignored) { netCallback = null; }
    }

    /** True when the active network (Wi-Fi, mobile data, ethernet) has validated internet. */
    @PluginMethod
    public void isOnline(final PluginCall call) {
        boolean online = false;
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
            online = caps != null
                    && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                        || caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                        || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        }
        JSObject ret = new JSObject();
        ret.put("online", online);
        call.resolve(ret);
    }

    private FrameLayout clipFrame = null;
    private NativeAdView adView = null;
    private TextView badgeView, headlineView, bodyView;
    private ImageView iconView;
    private Button ctaView;
    private MediaView mediaView;

    /**
     * Requests one native ad. The bridge call always settles within 15 s:
     * on fill → { loaded: true }, on error → { loaded: false, error: "code:msg" },
     * on timeout → { loaded: false, error: "TIMEOUT" }. A request that times
     * out keeps running natively; its late outcome is delivered through the
     * "adLoaded" / "adFailed" events, and further calls answer
     * LOAD_IN_PROGRESS until it finishes so requests never pile up.
     */
    @PluginMethod
    public void loadAd(final PluginCall call) {
        final String adId = call.getString("adId");
        if (adId == null || adId.isEmpty()) {
            call.reject("adId is required");
            return;
        }
        if (nativeAd != null) {
            resolveLoaded(call, true, null);
            return;
        }
        if (loading) {
            resolveLoaded(call, false, "LOAD_IN_PROGRESS");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            resolveLoaded(call, false, "NO_ACTIVITY");
            return;
        }
        loading = true;
        final boolean[] settled = { false };
        handler.postDelayed(() -> {
            if (settled[0]) return;
            settled[0] = true;
            Log.w(TAG, "native ad request timed out; still waiting for a late result");
            resolveLoaded(call, false, "TIMEOUT");
        }, 15_000L);
        activity.runOnUiThread(() -> {
            AdLoader loader = new AdLoader.Builder(activity, adId)
                    .forNativeAd(ad -> {
                        loading = false;
                        boolean late = settled[0];
                        settled[0] = true;
                        if (activity.isDestroyed()) {
                            ad.destroy();
                            return;
                        }
                        if (nativeAd != null) nativeAd.destroy();
                        nativeAd = ad;
                        Log.i(TAG, "native ad loaded: " + ad.getHeadline());
                        bindAd();
                        if (late) notifyListeners("adLoaded", new JSObject());
                        else resolveLoaded(call, true, null);
                    })
                    .withAdListener(new AdListener() {
                        @Override
                        public void onAdFailedToLoad(LoadAdError error) {
                            loading = false;
                            String reason = error.getCode() + ":" + error.getMessage();
                            Log.w(TAG, "native ad failed to load: " + reason);
                            if (settled[0]) {
                                JSObject ev = new JSObject();
                                ev.put("error", reason);
                                notifyListeners("adFailed", ev);
                                return;
                            }
                            settled[0] = true;
                            resolveLoaded(call, false, reason);
                        }
                    })
                    .withNativeAdOptions(new NativeAdOptions.Builder()
                            .setAdChoicesPlacement(NativeAdOptions.ADCHOICES_TOP_RIGHT)
                            .setMediaAspectRatio(NativeAdOptions.NATIVE_MEDIA_ASPECT_RATIO_ANY)
                            .build())
                    .build();
            loader.loadAd(new AdRequest.Builder().build());
        });
    }

    @PluginMethod
    public void setBounds(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("width", 0.0);
        final double h = call.getDouble("height", 0.0);
        final double clipTop = call.getDouble("clipTop", 0.0);
        final double clipBottom = call.getDouble("clipBottom", 0.0);
        final boolean visible = call.getBoolean("visible", true);
        final String label = call.getString("label", "Ad");
        final JSObject colors = call.getObject("colors", new JSObject());

        activity.runOnUiThread(() -> {
            ensureViews(activity);
            if (clipFrame == null || adView == null) return;
            if (!visible || nativeAd == null || w <= 0 || h <= 0 || clipBottom <= clipTop) {
                clipFrame.setVisibility(View.GONE);
                return;
            }
            float d = activity.getResources().getDisplayMetrics().density;
            WebView webView = getBridge().getWebView();

            applyColors(colors);
            badgeView.setText(label);

            int frameTop = Math.round((float) clipTop * d);
            int frameHeight = Math.round((float) (clipBottom - clipTop) * d);
            FrameLayout.LayoutParams fp = new FrameLayout.LayoutParams(webView.getWidth(), frameHeight);
            clipFrame.setLayoutParams(toParentParams(fp));
            clipFrame.setX(webView.getX());
            clipFrame.setY(webView.getY() + frameTop);

            FrameLayout.LayoutParams ap = new FrameLayout.LayoutParams(
                    Math.round((float) w * d), Math.round((float) h * d));
            ap.leftMargin = Math.round((float) x * d);
            ap.topMargin = Math.round((float) (y - clipTop) * d);
            adView.setLayoutParams(ap);
            clipFrame.setVisibility(View.VISIBLE);
        });
        call.resolve();
    }

    @PluginMethod
    public void hide(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (clipFrame != null) clipFrame.setVisibility(View.GONE);
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void destroy(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(this::tearDown);
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (netCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            try { if (cm != null) cm.unregisterNetworkCallback(netCallback); } catch (Exception ignored) {}
            netCallback = null;
        }
        tearDown();
    }

    // ── View construction ───────────────────────────────────────────────────
    private ViewGroup.LayoutParams toParentParams(FrameLayout.LayoutParams fp) {
        ViewGroup.LayoutParams lp = clipFrame.getLayoutParams();
        if (lp == null) return fp;
        lp.width = fp.width;
        lp.height = fp.height;
        return lp;
    }

    private int dp(Activity a, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                a.getResources().getDisplayMetrics()));
    }

    private void ensureViews(Activity activity) {
        if (clipFrame != null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null || !(webView.getParent() instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) webView.getParent();

        clipFrame = new FrameLayout(activity);
        clipFrame.setClipChildren(true);
        clipFrame.setClipToPadding(true);
        clipFrame.setVisibility(View.GONE);

        adView = new NativeAdView(activity);
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(dp(activity, 10), dp(activity, 10), dp(activity, 10), dp(activity, 10));

        mediaView = new MediaView(activity);
        mediaView.setImageScaleType(ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(dp(activity, 120), ViewGroup.LayoutParams.MATCH_PARENT);
        mp.rightMargin = dp(activity, 10);
        row.addView(mediaView, mp);

        LinearLayout col = new LinearLayout(activity);
        col.setOrientation(LinearLayout.VERTICAL);
        row.addView(col, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        LinearLayout top = new LinearLayout(activity);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        col.addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        badgeView = new TextView(activity);
        badgeView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
        badgeView.setTypeface(Typeface.DEFAULT_BOLD);
        badgeView.setPadding(dp(activity, 5), dp(activity, 1), dp(activity, 5), dp(activity, 1));
        top.addView(badgeView);

        iconView = new ImageView(activity);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(activity, 18), dp(activity, 18));
        ip.leftMargin = dp(activity, 6);
        top.addView(iconView, ip);

        headlineView = new TextView(activity);
        headlineView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        headlineView.setTypeface(Typeface.DEFAULT_BOLD);
        headlineView.setMaxLines(2);
        headlineView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.topMargin = dp(activity, 4);
        col.addView(headlineView, hp);

        bodyView = new TextView(activity);
        bodyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        bodyView.setMaxLines(2);
        bodyView.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(bodyView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        ctaView = new Button(activity);
        ctaView.setAllCaps(false);
        ctaView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        ctaView.setMinHeight(0);
        ctaView.setMinimumHeight(0);
        ctaView.setPadding(dp(activity, 12), dp(activity, 4), dp(activity, 12), dp(activity, 4));
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(activity, 30));
        cp.gravity = Gravity.END;
        col.addView(ctaView, cp);

        adView.addView(row, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        adView.setMediaView(mediaView);
        adView.setHeadlineView(headlineView);
        adView.setBodyView(bodyView);
        adView.setIconView(iconView);
        adView.setCallToActionView(ctaView);

        clipFrame.addView(adView);
        parent.addView(clipFrame, new ViewGroup.LayoutParams(0, 0));
        // Draw above the WebView regardless of the parent's z-ordering rules.
        clipFrame.setElevation(webView.getElevation() + dp(activity, 4));
        clipFrame.setTranslationZ(webView.getTranslationZ() + 1f);
        clipFrame.bringToFront();
        bindAd();
    }

    private void bindAd() {
        if (adView == null || nativeAd == null) return;
        headlineView.setText(nativeAd.getHeadline());
        String body = nativeAd.getBody();
        bodyView.setText(body == null ? "" : body);
        bodyView.setVisibility(body == null ? View.INVISIBLE : View.VISIBLE);
        String cta = nativeAd.getCallToAction();
        ctaView.setText(cta == null ? "" : cta);
        ctaView.setVisibility(cta == null ? View.GONE : View.VISIBLE);
        if (nativeAd.getIcon() != null) {
            iconView.setImageDrawable(nativeAd.getIcon().getDrawable());
            iconView.setVisibility(View.VISIBLE);
        } else {
            iconView.setVisibility(View.GONE);
        }
        if (nativeAd.getMediaContent() != null) mediaView.setMediaContent(nativeAd.getMediaContent());
        adView.setNativeAd(nativeAd);
    }

    private int parseColor(JSObject colors, String key, int fallback) {
        String v = colors.getString(key);
        if (v == null) return fallback;
        try {
            return Color.parseColor(v);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    private void applyColors(JSObject colors) {
        Activity a = getActivity();
        if (a == null) return;
        int surface = parseColor(colors, "surface", Color.parseColor("#1C1C1E"));
        int border = parseColor(colors, "border", Color.parseColor("#2C2C2E"));
        int fg = parseColor(colors, "foreground", Color.WHITE);
        int muted = parseColor(colors, "muted", Color.GRAY);
        int accent = parseColor(colors, "accent", Color.parseColor("#0A84FF"));
        int accentFg = parseColor(colors, "accentForeground", Color.WHITE);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(surface);
        bg.setCornerRadius(dp(a, 24));
        bg.setStroke(Math.max(1, dp(a, 1)), border);
        adView.setBackground(bg);
        adView.setClipToOutline(true);

        GradientDrawable badge = new GradientDrawable();
        badge.setColor(accent);
        badge.setCornerRadius(dp(a, 4));
        badgeView.setBackground(badge);
        badgeView.setTextColor(accentFg);

        headlineView.setTextColor(fg);
        bodyView.setTextColor(muted);

        GradientDrawable btn = new GradientDrawable();
        btn.setColor(accent);
        btn.setCornerRadius(dp(a, 15));
        ctaView.setBackground(btn);
        ctaView.setTextColor(accentFg);
    }

    private void tearDown() {
        if (clipFrame != null && clipFrame.getParent() instanceof ViewGroup) {
            ((ViewGroup) clipFrame.getParent()).removeView(clipFrame);
        }
        if (adView != null) adView.destroy();
        clipFrame = null;
        adView = null;
        if (nativeAd != null) nativeAd.destroy();
        nativeAd = null;
        loading = false;
    }

    private void resolveLoaded(final PluginCall call, final boolean loaded, final String error) {
        JSObject ret = new JSObject();
        ret.put("loaded", loaded);
        if (error != null) ret.put("error", error);
        call.resolve(ret);
    }
}
