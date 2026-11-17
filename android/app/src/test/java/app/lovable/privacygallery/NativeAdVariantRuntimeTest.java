package app.lovable.privacygallery;

import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Runs against the actual BuildConfig of EACH Gradle variant. This detects
 * release accidentally inheriting debug ad IDs or debug consent fallback
 * without contacting AdMob or granting consent.
 */
public final class NativeAdVariantRuntimeTest {
    @Test public void compiledVariantSelectsOnlyItsOwnNativeAdUnit() {
        String production = "ca-app-pub-9902253594429663/3903747602";
        String selected = NativeAdUnitPolicy.select(BuildConfig.USE_TEST_ADS, production);
        if (BuildConfig.USE_TEST_ADS) {
            assertEquals(NativeAdUnitPolicy.GOOGLE_TEST_NATIVE_UNIT, selected);
            assertTrue(BuildConfig.DEBUG_CONSENT_FALLBACK_MS > 0L);
        } else {
            assertEquals(production, selected);
            assertNotEquals(NativeAdUnitPolicy.GOOGLE_TEST_NATIVE_UNIT, selected);
            assertEquals("Release consent must never use debug fallback", 0L,
                    BuildConfig.DEBUG_CONSENT_FALLBACK_MS);
            assertEquals("", BuildConfig.UMP_DEBUG_GEOGRAPHY);
            assertEquals("", BuildConfig.UMP_TEST_DEVICE_ID);
        }
    }
    @Test public void noBuildTypeCanTurnAnEmptyProductionUnitIntoATestId() {
        String selected = NativeAdUnitPolicy.select(BuildConfig.USE_TEST_ADS, "");
        assertEquals(BuildConfig.USE_TEST_ADS
                ? NativeAdUnitPolicy.GOOGLE_TEST_NATIVE_UNIT : "", selected);
    }
}
