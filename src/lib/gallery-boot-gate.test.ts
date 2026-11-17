import { afterEach, describe, expect, it, vi } from "vitest";
import { afterMeasuredGalleryLayout } from "./gallery-boot-gate";

afterEach(() => {
  delete document.documentElement.dataset.novaBootPhase;
  vi.restoreAllMocks();
});

describe("Android measured-layout gate for optional native ads", () => {
  it("does not begin an ad bridge while React exists but real Android tabs are unmeasured", async () => {
    document.documentElement.dataset.novaBootPhase = "root-route-committed";
    const start = vi.fn();
    const stop = afterMeasuredGalleryLayout(start);
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
    document.documentElement.dataset.novaBootPhase = "gallery-layout-ready";
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(start).toHaveBeenCalledTimes(1);
    document.documentElement.dataset.novaBootPhase = "gallery-layout-ready";
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(start).toHaveBeenCalledTimes(1);
    stop();
  });

  it("cancels pending startup when gallery ad slot unmounts before the first real frame", async () => {
    const start = vi.fn();
    const stop = afterMeasuredGalleryLayout(start);
    stop();
    document.documentElement.dataset.novaBootPhase = "gallery-layout-ready";
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(start).not.toHaveBeenCalled();
  });

  it("even an already measured gallery starts optional work on a later microtask", async () => {
    document.documentElement.dataset.novaBootPhase = "gallery-layout-ready";
    const start = vi.fn();
    const stop = afterMeasuredGalleryLayout(start);
    expect(start).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    stop();
  });

  it("can abort a callback that was queued by a ready gallery", async () => {
    document.documentElement.dataset.novaBootPhase = "gallery-layout-ready";
    const start = vi.fn();
    afterMeasuredGalleryLayout(start)();
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });
});
