import { useEffect, useRef } from "react";

type ViewerVideoProps = {
  src: string;
  transform: string;
  onDimensions: (width: number, height: number) => void;
};

/**
 * Keep the viewer's video decoder tied to the visible player.
 * Old Android WebViews can keep a file descriptor, decoder and audio stream
 * after removing <video>; explicitly pause and release the source.
 * Image viewing, the original file and user's video controls are unchanged.
 */
export function ViewerVideo({ src, transform, onDimensions }: ViewerVideoProps) {
  const media = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = media.current;
    return () => {
      if (!video) return;
      try { video.pause(); } catch { /* Older WebView can reject a stopped decoder. */ }
      // Guard against a changed URL on a reused element; never clear the new
      // media source while an obsolete cleanup runs.
      if (video.getAttribute("src") !== src) return;
      video.removeAttribute("src");
      try { video.load(); } catch { /* Detached WebView video element. */ }
    };
  }, [src]);

  return (
    <video
      ref={media}
      src={src}
      data-viewer-media
      controls
      autoPlay
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => {
        const v = event.currentTarget;
        onDimensions(v.videoWidth, v.videoHeight);
      }}
      className="max-h-full max-w-full"
      style={{ transform }}
    />
  );
}
