package app.lovable.privacygallery;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

/**
 * Real compiled Android build-type contract. This test does not contact
 * AdMob, request consent, display an ad, or touch any user media.
 */
@RunWith(AndroidJUnit4.class)
public class NativeAdBuildPolicyTest {
    @Test
    public void installedDebugApkNeverSelectsProductionAdUnits() {
        assertTrue("Device CI must use the test-ads debug APK", BuildConfig.USE_TEST_ADS);
        assertTrue("Debug-only fallback must not be used in release",
                BuildConfig.DEBUG_CONSENT_FALLBACK_MS > 0);
        String bogusProductionUnit = "production-ad-unit-should-not-be-used";
        assertEquals(NativeAdUnitPolicy.GOOGLE_TEST_NATIVE_UNIT,
                NativeAdUnitPolicy.select(BuildConfig.USE_TEST_ADS, bogusProductionUnit));
        assertNotEquals(bogusProductionUnit,
                NativeAdUnitPolicy.select(BuildConfig.USE_TEST_ADS, bogusProductionUnit));
    }

    @Test
    public void productionBranchSelectsTheProvidedProductionUnitExactly() {
        String actualProductionUnit = "opaque-production-native-unit";
        assertEquals(actualProductionUnit,
                NativeAdUnitPolicy.select(false, actualProductionUnit));
        assertNotEquals(NativeAdUnitPolicy.GOOGLE_TEST_NATIVE_UNIT,
                NativeAdUnitPolicy.select(false, actualProductionUnit));
    }

    @Test
    public void resolvedConsentDenialCannotEnableDebugAdFallback() {
        assertTrue(NativeAdsPlugin.canUsePendingDebugFallback(true, 10_000L, false, false));
        assertFalse(NativeAdsPlugin.canUsePendingDebugFallback(true, 10_000L, true, false));
        assertFalse(NativeAdsPlugin.canUsePendingDebugFallback(false, 10_000L, false, false));
        assertFalse(NativeAdsPlugin.canUsePendingDebugFallback(true, 0L, false, false));
        assertFalse(NativeAdsPlugin.canUsePendingDebugFallback(true, 10_000L, false, true));
    }

    @Test
    public void realUmpDenialOverridesExpiredDebugPermission() {
        assertTrue("Pending debug request may show test ad",
                NativeAdsPlugin.effectiveAdPermission(true, true, false));
        assertFalse("Debug fallback cleared by a completed UMP refusal",
                NativeAdsPlugin.effectiveAdPermission(true, false, false));
        assertFalse("Release never allows debug fallback",
                NativeAdsPlugin.effectiveAdPermission(false, true, false));
        assertTrue("Real permitted consent still works",
                NativeAdsPlugin.effectiveAdPermission(false, false, true));
    }

    @Test
    public void consentSettingsAndBuildInfoMatchDebugPolicy() {
        // A different network type or launcher mode must never select an
        // actual production unit inside an unsigned debug APK.
        assertTrue(BuildConfig.USE_TEST_ADS);
        assertEquals(NativeAdUnitPolicy.GOOGLE_TEST_NATIVE_UNIT,
                NativeAdUnitPolicy.select(true, "bad-user-supplied-production-id"));
    }
}
