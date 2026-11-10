package app.lovable.privacygallery;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Native ad overlay geometry is independent of menu-open state. */
@RunWith(AndroidJUnit4.class)
public class NativeAdOverlayGeometryTest {
    @Test public void adOnlyCoversItsOwnTileAndNotNeighboringFolders() {
        NativeAdOverlayGeometry.Clip c = NativeAdOverlayGeometry.calculate(
                16, 108, 152, 192, 72, 896, 360, 920);
        assertNotNull(c);
        assertEquals(16.0, c.left, 0.001);
        assertEquals(108.0, c.top, 0.001);
        assertEquals(152.0, c.width, 0.001);
        assertEquals(192.0, c.height, 0.001);
        assertEquals(0.0, c.adOffsetX, 0.001);
        assertEquals(0.0, c.adOffsetY, 0.001);
        assertTrue("The ad must not occupy the full gallery",
                c.width < 360 && c.height < 920);
    }

    @Test public void scrollingUnderStickyHeaderClipsAdNotOtherCards() {
        NativeAdOverlayGeometry.Clip c = NativeAdOverlayGeometry.calculate(
                16, 50, 152, 192, 96, 896, 360, 920);
        assertNotNull(c);
        assertEquals(96.0, c.top, 0.001);
        assertEquals(146.0, c.height, 0.001);
        assertEquals(-46.0, c.adOffsetY, 0.001);
    }

    @Test public void adScrollingUnderBottomNavigationIsClipped() {
        NativeAdOverlayGeometry.Clip c = NativeAdOverlayGeometry.calculate(
                16, 816, 152, 192, 96, 880, 360, 920);
        assertNotNull(c);
        assertEquals(816.0, c.top, 0.001);
        assertEquals(64.0, c.height, 0.001);
    }

    @Test public void sideCutoutCropsWithoutExpandingLayer() {
        NativeAdOverlayGeometry.Clip c = NativeAdOverlayGeometry.calculate(
                -12, 110, 152, 192, 96, 896, 360, 920);
        assertNotNull(c);
        assertEquals(0.0, c.left, 0.001);
        assertEquals(140.0, c.width, 0.001);
        assertEquals(-12.0, c.adOffsetX, 0.001);
    }

    @Test public void offscreenAndInvalidAdNeverCreateFullscreenOverlay() {
        assertNull(NativeAdOverlayGeometry.calculate(
                16, -300, 152, 100, 96, 896, 360, 920));
        assertNull(NativeAdOverlayGeometry.calculate(
                16, 916, 152, 192, 96, 896, 360, 920));
        assertNull(NativeAdOverlayGeometry.calculate(
                16, 110, 0, 192, 96, 896, 360, 920));
        assertNull(NativeAdOverlayGeometry.calculate(
                Double.NaN, 110, 152, 192, 96, 896, 360, 920));
    }
}
