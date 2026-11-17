import { render, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewerVideo } from "./ViewerVideo";

afterEach(() => vi.restoreAllMocks());

describe("Android fullscreen video decoder lifecycle", () => {
  it("keeps playback controls and reports real video dimensions", () => {
    const onDimensions = vi.fn();
    const { container, unmount } = render(
      <ViewerVideo src="blob:ci-video" transform="rotate(0deg)" onDimensions={onDimensions} />,
    );
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("blob:ci-video");
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.getAttribute("preload")).toBe("metadata");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 96 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 64 });
    fireEvent.loadedMetadata(video);
    expect(onDimensions).toHaveBeenCalledWith(96, 64);
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "load").mockImplementation(() => {});
    unmount();
  });

  it("pauses playback and releases the media source when the viewer closes", () => {
    const onDimensions = vi.fn();
    const { container, unmount } = render(
      <ViewerVideo src="blob:ci-video" transform="" onDimensions={onDimensions} />,
    );
    const video = container.querySelector("video")!;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    unmount();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("does not erase a newer URL if a video element is reused", () => {
    const onDimensions = vi.fn();
    const { container, rerender, unmount } = render(
      <ViewerVideo src="blob:first" transform="" onDimensions={onDimensions} />,
    );
    const video = container.querySelector("video")!;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    rerender(<ViewerVideo src="blob:second" transform="" onDimensions={onDimensions} />);
    expect(video.getAttribute("src")).toBe("blob:second");
    expect(pause).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    unmount();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
