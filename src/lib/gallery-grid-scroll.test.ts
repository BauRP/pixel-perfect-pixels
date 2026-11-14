import { afterEach, describe, expect, it, vi } from "vitest";
import { galleryGridRange, galleryGridScrollTarget, galleryGridViewport } from "./gallery-grid-scroll";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("gallery album virtual scrolling", () => {
  it("observes the real AppShell scroll container instead of a stationary window", () => {
    const scroller = document.createElement("div");
    scroller.setAttribute("data-app-content", "");
    const grid = document.createElement("div");
    scroller.appendChild(grid);
    document.body.appendChild(scroller);

    const target = galleryGridScrollTarget(grid);
    expect(target).toBe(scroller);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 35, bottom: 535, left: 0, right: 360, width: 360, height: 500,
      x: 0, y: 35, toJSON: () => ({}),
    });
    expect(galleryGridViewport(target)).toEqual({ top: 35, bottom: 535 });

    const changed = vi.fn();
    target.addEventListener("scroll", changed, { passive: true });
    window.dispatchEvent(new Event("scroll"));
    expect(changed).not.toHaveBeenCalled();
    scroller.dispatchEvent(new Event("scroll"));
    expect(changed).toHaveBeenCalledTimes(1);
    target.removeEventListener("scroll", changed);
    scroller.dispatchEvent(new Event("scroll"));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("moves the row window with content scrolling and never drops the final media item", () => {
    const atTop = galleryGridRange(1800, 3, 124, 120, 35, 535);
    const scrolled = galleryGridRange(1800, 3, 124, -2500, 35, 535);
    expect(atTop[0]).toBe(0);
    expect(scrolled[0]).toBeGreaterThan(atTop[0]);
    expect(scrolled[1]).toBeGreaterThan(scrolled[0]);
    expect(galleryGridRange(1800, 3, 124, -100000, 35, 535)).toEqual([1797, 1800]);
  });

  it("recovers from a large-album scroll position after filtering to a handful of items", () => {
    expect(galleryGridRange(5, 3, 124, -2500, 35, 535)).toEqual([3, 5]);
    expect(galleryGridRange(0, 3, 124, -2500, 35, 535)).toEqual([0, 0]);
    expect(galleryGridRange(2, 3, 124, 120, 35, 535)).toEqual([0, 2]);
  });

  it("falls back to window scrolling in a website without the persistent Android frame", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const target = galleryGridScrollTarget(el);
    expect(target).toBe(window);
    expect(galleryGridViewport(target)).toEqual({ top: 0, bottom: window.innerHeight });
  });
});
