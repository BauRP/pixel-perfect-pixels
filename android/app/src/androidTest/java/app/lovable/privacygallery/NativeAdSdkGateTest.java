package app.lovable.privacygallery;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

/** SDK readiness, not native ad presentation, is under test. */
@RunWith(AndroidJUnit4.class)
public class NativeAdSdkGateTest {
    @Test public void adRequestWaitsUntilGoogleSdkInitializationCompletes() {
        NativeAdSdkGate gate = new NativeAdSdkGate();
        AtomicInteger loaded = new AtomicInteger();
        gate.await(loaded::incrementAndGet);
        assertEquals(0, loaded.get());
        assertFalse(gate.isReady());
        gate.complete();
        assertEquals(1, loaded.get());
        assertTrue(gate.isReady());
        gate.complete();
        assertEquals(1, loaded.get());
    }

    @Test public void alreadyReadySdkStartsWithoutWaitingForMenuEvents() {
        NativeAdSdkGate gate = new NativeAdSdkGate();
        gate.complete();
        AtomicInteger loaded = new AtomicInteger();
        gate.await(loaded::incrementAndGet);
        assertEquals(1, loaded.get());
    }

    @Test public void failedInitializationClearsPendingAndCanRetry() {
        NativeAdSdkGate gate = new NativeAdSdkGate();
        AtomicInteger loaded = new AtomicInteger();
        gate.await(loaded::incrementAndGet);
        assertTrue(gate.fail());
        gate.complete();
        assertEquals(0, loaded.get());
        gate.await(loaded::incrementAndGet);
        assertEquals(1, loaded.get());
    }

    @Test public void timedOutRequestCannotRunLaterAndCannotExpireNewOne() {
        NativeAdSdkGate gate = new NativeAdSdkGate();
        AtomicInteger loaded = new AtomicInteger();
        Runnable first = loaded::incrementAndGet;
        gate.await(first);
        assertTrue(gate.expire(first));
        Runnable second = loaded::incrementAndGet;
        gate.await(second);
        assertFalse(gate.expire(first));
        gate.complete();
        assertEquals(1, loaded.get());
    }

    @Test public void removedActivityDropsUnstartedAdRequest() {
        NativeAdSdkGate gate = new NativeAdSdkGate();
        AtomicInteger loaded = new AtomicInteger();
        gate.await(loaded::incrementAndGet);
        gate.clear();
        gate.complete();
        assertEquals(0, loaded.get());
    }
}
