import { describe, expect, it, vi } from "vitest";
import { createLatestAsyncDispatcher, rectanglesOverlap } from "./native-ad-placement";

describe("native ad and independent gallery menu", () => {
  it("does not hide an ad merely because the menu opens elsewhere", () => {
    const ad = { left: 16, top: 160, right: 165, bottom: 365 };
    const menu = { left: 180, top: 55, right: 344, bottom: 250 };
    expect(rectanglesOverlap(ad, menu)).toBe(false);
    expect(rectanglesOverlap(ad, { left: 150, top: 170, right: 344, bottom: 270 })).toBe(true);
    expect(rectanglesOverlap(ad, { left: 165, top: 160, right: 345, bottom: 365 })).toBe(false);
    expect(rectanglesOverlap(ad, { left: NaN, top: 0, right: 400, bottom: 400 })).toBe(false);
  });

  it("does not let an obsolete hide override the latest visible tile", async () => {
    let completeFirst!: () => void;
    const first = new Promise<void>((resolve) => { completeFirst = resolve; });
    const delivered: string[] = [];
    const send = vi.fn(async (value: string) => {
      delivered.push(value);
      if (value === "first") await first;
    });
    const submit = createLatestAsyncDispatcher(send);
    submit("first");
    submit("menu temporarily covered");
    submit("visible after menu closes");
    expect(delivered).toEqual(["first"]);
    completeFirst();
    await vi.waitFor(() => expect(delivered).toEqual(["first", "visible after menu closes"]));
  });

  it("delivers a final hide when leaving the gallery", async () => {
    let complete!: () => void;
    const first = new Promise<void>((resolve) => { complete = resolve; });
    const delivered: string[] = [];
    const submit = createLatestAsyncDispatcher<string>(async (state) => {
      delivered.push(state);
      if (state === "bounds-1") await first;
    });
    submit("bounds-1");
    submit("bounds-2");
    submit("hide");
    complete();
    await vi.waitFor(() => expect(delivered).toEqual(["bounds-1", "hide"]));
  });

  it("continues to place a later ad after a bridge error", async () => {
    const error = vi.fn();
    const delivered: string[] = [];
    const submit = createLatestAsyncDispatcher<string>(async (v) => {
      delivered.push(v);
      if (v === "failed") throw new Error("native unavailable");
    }, error);
    submit("failed");
    submit("visible");
    await vi.waitFor(() => expect(delivered).toEqual(["failed", "visible"]));
    expect(error).toHaveBeenCalledTimes(1);
  });
});
