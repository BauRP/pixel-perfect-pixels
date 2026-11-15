package app.lovable.privacygallery;

/**
 * The one ad-unit selection policy used by NativeAdsPlugin for every request.
 * BuildConfig.USE_TEST_ADS comes from the Android build type, not from the
 * debuggable flag of an Activity or from a WebView/JS setting.
 * No network call or consent override is performed here.
 */
final class NativeAdUnitPolicy {
    static final String GOOGLE_TEST_NATIVE_UNIT =
            "ca-app-pub-3940256099942544/2247696110";

    private NativeAdUnitPolicy() {}

    static String select(boolean useTestAds, String productionUnit) {
        return useTestAds ? GOOGLE_TEST_NATIVE_UNIT : productionUnit;
    }
}
