package app.lovable.privacygallery;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
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
import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Google Mobile Ads "Native Advanced" bridge for the first gallery slot.
 *
 * The WebView always renders the slot container; this plugin draws a real
 * NativeAdView over it once an ad is loaded. Only SDK-registered asset views
 * (headline, body, icon, media, call-to-action, advertiser) are clickable.
 *
 * Methods:
 *   getNetworkState()            → { status, transport }
 *   loadAd({ adId })             → resolves immediately { started | reason };
 *                                   the outcome arrives as "adLoaded" / "adFailed"
 *   setBounds({...})             → positions/styles the overlay (CSS px)
 *   hide()                       → hides the overlay, keeps the ad
 *   destroy()                    → removes the overlay and destroys the ad
 * Events:
 *   networkChanged { status: none|unvalidated|online, transport: wifi|cellular|ethernet|other|none }
 *   adLoaded {}
 *   adFailed { code, message, noFill }
 */
@CapacitorPlugin(name = "NativeAds")
public class NativeAdsPlugin extends Plugin {

    private static final String TAG = "NativeAds";
    /** Google's official native-advanced test unit — used for every debuggable build. */
    private static final String TEST_NATIVE_AD_UNIT_ID = "ca-app-pub-3940256099942544/2247696110";

    private NativeAd nativeAd = null;
    private boolean loading = false;
    private final AtomicBoolean sdkInitStarted = new AtomicBoolean(false);
    private ConsentInformation consentInfo = null;
    /** True once the consent info request for this session has completed (success or error). */
    private volatile boolean consentResolved = false;
    /** Debug builds only: set when the consent flow did not finish within DEBUG_CONSENT_FALLBACK_MS. */
    private volatile boolean debugConsentFallback = false;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private ConnectivityManager.NetworkCallback netCallback = null;
    private String lastNetKey = "";

    private FrameLayout clipFrame = null;
    private NativeAdView adView = null;
    private TextView badgeView, headlineView, bodyView, advertiserView;
    private ImageView iconView;
    private Button ctaView;
    private MediaView mediaView;

    @Override
    public void load() {
        super.load();
        registerNetworkCallback();
        gatherConsent();
    }

    /** The only Google Mobile Ads SDK initialization in the app (off the UI thread). */
    private void initSdk() {
        if (!sdkInitStarted.compareAndSet(false, true)) return;
        final Context appCtx = getContext().getApplicationContext();
        new Thread(() -> {
            try {
                MobileAds.initialize(appCtx, status -> Log.i(TAG, "Mobile Ads SDK ready"));
            } catch (Throwable t) {
                Log.w(TAG, "Mobile Ads SDK init failed", t);
            }
        }, "mobile-ads-init").start();
    }

    // ── Google UMP consent (EEA / UK) ───────────────────────────────────────
    /**
     * Requests the latest consent info on every launch and shows the consent
     * form when required. MobileAds.initialize() runs only once ads may be
     * requested; a previous session's consent lets ads start immediately.
     */
    private void gatherConsent() {
        final Activity activity = getActivity();
        if (activity == null) return;
        consentInfo = UserMessagingPlatform.getConsentInformation(activity);
        ConsentRequestParameters.Builder pb = new ConsentRequestParameters.Builder();
        // Debug-only geography override (BuildConfig values are empty in release).
        if (!BuildConfig.UMP_DEBUG_GEOGRAPHY.isEmpty()) {
            ConsentDebugSettings.Builder db = new ConsentDebugSettings.Builder(activity);
            switch (BuildConfig.UMP_DEBUG_GEOGRAPHY) {
                case "EEA": db.setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA); break;
                case "OTHER": db.setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_OTHER); break;
                default: break;
            }
            if (!BuildConfig.UMP_TEST_DEVICE_ID.isEmpty()) db.addTestDeviceHashedId(BuildConfig.UMP_TEST_DEVICE_ID);
            pb.setConsentDebugSettings(db.build());
        }
        ConsentRequestParameters params = pb.build();
        activity.runOnUiThread(() -> consentInfo.requestConsentInfoUpdate(activity, params,
                () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity, formError -> {
                    if (formError != null) Log.w(TAG, "consent form: " + formError.getMessage());
                    onConsentResolved();
                }),
                requestError -> {
                    Log.w(TAG, "consent info update failed: " + requestError.getMessage());
                    onConsentResolved();
                }));
        if (consentInfo.canRequestAds()) initSdk();
        // Debug/test builds only: if UMP never resolves (emulator, no message configured),
        // allow TEST ad requests so development is not blocked. Release value is 0 → disabled.
        if (BuildConfig.USE_TEST_ADS && BuildConfig.DEBUG_CONSENT_FALLBACK_MS > 0) {
            mainHandler.postDelayed(() -> {
                if (consentResolved && canRequestAds()) return;
                Log.w(TAG, "consent unresolved after " + BuildConfig.DEBUG_CONSENT_FALLBACK_MS
                        + " ms — DEBUG fallback: allowing test ad requests");
                debugConsentFallback = true;
                consentResolved = true;
                initSdk();
                notifyListeners("consentUpdated", consentStatus(), true);
            }, BuildConfig.DEBUG_CONSENT_FALLBACK_MS);
        }
    }

    private boolean privacyOptionsRequired() {
        return consentInfo != null && consentInfo.getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
    }

    private void onConsentResolved() {
        consentResolved = true;
        if (consentInfo != null && consentInfo.canRequestAds()) initSdk();
        notifyListeners("consentUpdated", consentStatus(), true);
    }

    private JSObject consentStatus() {
        JSObject o = new JSObject();
        o.put("required", privacyOptionsRequired());
        o.put("canRequestAds", canRequestAds());
        o.put("resolved", consentResolved);
        o.put("debugFallback", debugConsentFallback);
        return o;
    }

    /** Forwards JS ad-state diagnostics to logcat (tag NativeAds). No personal data is logged. */
    @PluginMethod
    public void log(final PluginCall call) {
        String level = call.getString("level", "info");
        String msg = call.getString("message", "");
        if ("error".equals(level)) Log.e(TAG, "[js] " + msg);
        else if ("warn".equals(level)) Log.w(TAG, "[js] " + msg);
        else Log.i(TAG, "[js] " + msg);
        call.resolve();
    }

    @PluginMethod
    public void getBuildInfo(final PluginCall call) {
        JSObject o = new JSObject();
        o.put("testAds", BuildConfig.USE_TEST_ADS);
        o.put("allowUnvalidatedNetwork", BuildConfig.ALLOW_UNVALIDATED_NETWORK);
        call.resolve(o);
    }

    @PluginMethod
    public void getConsentStatus(final PluginCall call) {
        call.resolve(consentStatus());
    }

    private boolean canRequestAds() {
        if (BuildConfig.USE_TEST_ADS && debugConsentFallback) return true;
        return consentInfo != null && consentInfo.canRequestAds();
    }

    @PluginMethod
    public void getPrivacyOptionsStatus(final PluginCall call) {
        JSObject r = new JSObject();
        r.put("required", privacyOptionsRequired());
        call.resolve(r);
    }

    @PluginMethod
    public void showPrivacyOptionsForm(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("NO_ACTIVITY");
            return;
        }
        activity.runOnUiThread(() -> UserMessagingPlatform.showPrivacyOptionsForm(activity, formError -> {
            if (formError != null) Log.w(TAG, "privacy options form: " + formError.getMessage());
            onConsentResolved();
            JSObject r = new JSObject();
            r.put("required", privacyOptionsRequired());
            call.resolve(r);
        }));
    }


    // ── Connectivity (event driven, no polling, no location permission) ──────
    private void registerNetworkCallback() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null || netCallback != null) return;
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { emitNetwork(); }
            @Override public void onLost(Network network) { emitNetwork(); }
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) { emitNetwork(); }
        };
        try {
            cm.registerDefaultNetworkCallback(netCallback);
        } catch (Exception e) {
            netCallback = null;
        }
    }

    private JSObject readNetwork() {
        String status = "none";
        String transport = "none";
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            Network active = cm.getActiveNetwork();
            NetworkCapabilities caps = active == null ? null : cm.getNetworkCapabilities(active);
            if (caps != null) {
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transport = "wifi";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transport = "cellular";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transport = "ethernet";
                else transport = "other";
                boolean internet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                boolean validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                if (internet && validated) status = "online";
                else if (internet && BuildConfig.ALLOW_UNVALIDATED_NETWORK) status = "online"; // SDK decides; failures back off
                else status = "unvalidated";
            }
        }
        JSObject o = new JSObject();
        o.put("status", status);
        o.put("transport", transport);
        return o;
    }

    private void emitNetwork() {
        JSObject o = readNetwork();
        String key = o.getString("status") + "/" + o.getString("transport");
        if (key.equals(lastNetKey)) return;
        lastNetKey = key;
        notifyListeners("networkChanged", o);
    }

    @PluginMethod
    public void getNetworkState(final PluginCall call) {
        call.resolve(readNetwork());
    }

    // ── Loading ─────────────────────────────────────────────────────────────
    @PluginMethod
    public void loadAd(final PluginCall call) {
        final String prodId = call.getString("adId");
        if (prodId == null || prodId.isEmpty()) {
            call.reject("adId is required");
            return;
        }
        JSObject ret = new JSObject();
        if (nativeAd != null) {
            ret.put("started", false);
            ret.put("reason", "ALREADY_LOADED");
            call.resolve(ret);
            notifyListeners("adLoaded", new JSObject());
            return;
        }
        if (loading) {
            ret.put("started", false);
            ret.put("reason", "LOAD_IN_PROGRESS");
            call.resolve(ret);
            return;
        }
        final Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            ret.put("started", false);
            ret.put("reason", "NO_ACTIVITY");
            call.resolve(ret);
            return;
        }
        if (!canRequestAds()) {
            // Consent not yet given/resolved: no ad request; JS backoff retries later.
            ret.put("started", false);
            ret.put("reason", consentResolved ? "CONSENT_REQUIRED" : "CONSENT_PENDING");
            call.resolve(ret);
            return;
        }
        initSdk();
        final String adId = BuildConfig.USE_TEST_ADS ? TEST_NATIVE_AD_UNIT_ID : prodId;
        loading = true;
        ret.put("started", true);
        call.resolve(ret);

        activity.runOnUiThread(() -> {
            try {
                AdLoader loader = new AdLoader.Builder(activity, adId)
                        .forNativeAd(ad -> {
                            loading = false;
                            Activity a = getActivity();
                            if (a == null || a.isDestroyed() || a.isFinishing()) {
                                ad.destroy();
                                return;
                            }
                            if (nativeAd != null) nativeAd.destroy();
                            nativeAd = ad;
                            bindAd();
                            notifyListeners("adLoaded", new JSObject());
                        })
                        .withAdListener(new AdListener() {
                            @Override
                            public void onAdFailedToLoad(LoadAdError error) {
                                loading = false;
                                Log.w(TAG, "native ad failed: " + error.getCode() + " " + error.getMessage());
                                JSObject ev = new JSObject();
                                ev.put("code", error.getCode());
                                ev.put("message", error.getMessage());
                                ev.put("noFill", error.getCode() == AdRequest.ERROR_CODE_NO_FILL);
                                notifyListeners("adFailed", ev);
                            }
                        })
                        .withNativeAdOptions(new NativeAdOptions.Builder()
                                .setAdChoicesPlacement(NativeAdOptions.ADCHOICES_TOP_RIGHT)
                                .setMediaAspectRatio(NativeAdOptions.NATIVE_MEDIA_ASPECT_RATIO_ANY)
                                .build())
                        .build();
                loader.loadAd(new AdRequest.Builder().build());
            } catch (Throwable t) {
                loading = false;
                JSObject ev = new JSObject();
                ev.put("code", -1);
                ev.put("message", String.valueOf(t.getMessage()));
                ev.put("noFill", false);
                notifyListeners("adFailed", ev);
            }
        });
    }

    // ── Overlay placement ───────────────────────────────────────────────────
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
            JSObject res = new JSObject();
            if (nativeAd == null) {
                if (clipFrame != null) clipFrame.setVisibility(View.GONE);
                res.put("shown", false);
                res.put("reason", "NO_AD");
                call.resolve(res);
                return;
            }
            ensureViews(activity);
            if (clipFrame == null || adView == null) {
                // WebView hierarchy not ready yet — JS re-sends bounds on the next frame/event.
                res.put("shown", false);
                res.put("reason", "VIEW_NOT_READY");
                call.resolve(res);
                return;
            }
            if (!visible || w <= 0 || h <= 0 || clipBottom <= clipTop) {
                clipFrame.setVisibility(View.GONE);
                res.put("shown", false);
                res.put("reason", "HIDDEN");
                call.resolve(res);
                return;
            }
            float d = activity.getResources().getDisplayMetrics().density;
            WebView webView = getBridge().getWebView();

            applyColors(colors);
            badgeView.setText(label);

            int frameTop = Math.round((float) clipTop * d);
            int frameHeight = Math.round((float) (clipBottom - clipTop) * d);
            ViewGroup.LayoutParams lp = clipFrame.getLayoutParams();
            lp.width = webView.getWidth();
            lp.height = frameHeight;
            clipFrame.setLayoutParams(lp);
            clipFrame.setX(webView.getX());
            clipFrame.setY(webView.getY() + frameTop);

            FrameLayout.LayoutParams ap = new FrameLayout.LayoutParams(
                    Math.round((float) w * d), Math.round((float) h * d));
            ap.leftMargin = Math.round((float) x * d);
            ap.topMargin = Math.round((float) (y - clipTop) * d);
            adView.setLayoutParams(ap);
            clipFrame.setVisibility(View.VISIBLE);
            clipFrame.bringToFront();
            res.put("shown", true);
            call.resolve(res);
        });
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
        if (activity != null) activity.runOnUiThread(this::tearDown);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        if (netCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            try { if (cm != null) cm.unregisterNetworkCallback(netCallback); } catch (Exception ignored) {}
            netCallback = null;
        }
        tearDown();
    }

    // ── View construction ───────────────────────────────────────────────────
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
        // Square single-cell card (matches a folder tile): media on top, text below.
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(activity, 8), dp(activity, 8), dp(activity, 8), dp(activity, 8));

        mediaView = new MediaView(activity);
        mediaView.setImageScaleType(ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        mp.bottomMargin = dp(activity, 6);
        row.addView(mediaView, mp);

        LinearLayout col = new LinearLayout(activity);
        col.setOrientation(LinearLayout.VERTICAL);
        row.addView(col, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout top = new LinearLayout(activity);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        // Leave room on the right for the SDK-drawn AdChoices icon.
        top.setPadding(0, 0, dp(activity, 18), 0);
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

        advertiserView = new TextView(activity);
        advertiserView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        advertiserView.setMaxLines(1);
        advertiserView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams avp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        avp.leftMargin = dp(activity, 6);
        top.addView(advertiserView, avp);

        headlineView = new TextView(activity);
        headlineView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        headlineView.setTypeface(Typeface.DEFAULT_BOLD);
        headlineView.setMaxLines(1);
        headlineView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.topMargin = dp(activity, 2);
        col.addView(headlineView, hp);

        bodyView = new TextView(activity);
        bodyView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        bodyView.setMaxLines(1);
        bodyView.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(bodyView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ctaView = new Button(activity);
        ctaView.setAllCaps(false);
        ctaView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        ctaView.setMinHeight(0);
        ctaView.setMinimumHeight(0);
        ctaView.setMinWidth(0);
        ctaView.setMinimumWidth(0);
        ctaView.setMaxLines(1);
        ctaView.setPadding(dp(activity, 8), dp(activity, 2), dp(activity, 8), dp(activity, 2));
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, 26));
        cp.topMargin = dp(activity, 4);
        col.addView(ctaView, cp);

        adView.addView(row, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        adView.setMediaView(mediaView);
        adView.setHeadlineView(headlineView);
        adView.setBodyView(bodyView);
        adView.setIconView(iconView);
        adView.setAdvertiserView(advertiserView);
        adView.setCallToActionView(ctaView);

        clipFrame.addView(adView);
        parent.addView(clipFrame, new ViewGroup.LayoutParams(0, 0));
        clipFrame.setElevation(webView.getElevation() + dp(activity, 4));
        clipFrame.setTranslationZ(webView.getTranslationZ() + 1f);
        clipFrame.bringToFront();
        bindAd();
    }

    /** Binds only assets supplied by the ad; optional assets are hidden when absent. */
    private void bindAd() {
        if (adView == null || nativeAd == null) return;
        headlineView.setText(nativeAd.getHeadline());

        String body = nativeAd.getBody();
        bodyView.setText(body == null ? "" : body);
        bodyView.setVisibility(body == null ? View.INVISIBLE : View.VISIBLE);

        String advertiser = nativeAd.getAdvertiser();
        advertiserView.setText(advertiser == null ? "" : advertiser);
        advertiserView.setVisibility(advertiser == null ? View.GONE : View.VISIBLE);

        String cta = nativeAd.getCallToAction();
        ctaView.setText(cta == null ? "" : cta);
        ctaView.setVisibility(cta == null ? View.GONE : View.VISIBLE);

        if (nativeAd.getIcon() != null) {
            iconView.setImageDrawable(nativeAd.getIcon().getDrawable());
            iconView.setVisibility(View.VISIBLE);
        } else {
            iconView.setVisibility(View.GONE);
        }

        if (nativeAd.getMediaContent() != null) {
            mediaView.setMediaContent(nativeAd.getMediaContent());
            mediaView.setVisibility(View.VISIBLE);
        } else {
            mediaView.setVisibility(View.GONE);
        }
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
        advertiserView.setTextColor(muted);

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
        if (nativeAd != null) nativeAd.destroy();
        clipFrame = null;
        adView = null;
        boolean had = nativeAd != null;
        nativeAd = null;
        loading = false;
        if (had) notifyListeners("adGone", new JSObject());
    }
}
