import { afterEach, describe, expect, it, vi } from "vitest";
import { processInBatches } from "./scan-batching";

afterEach(() => vi.useRealTimers());

describe("nonblocking MediaStore conversion", () => {
  it("visits every file in order while yielding between bounded batches", async () => {
    vi.useFakeTimers();
    const visited: number[] = [];
    const work = processInBatches([0, 1, 2, 3, 4, 5, 6], id => visited.push(id), 3);
    expect(visited).toEqual([0, 1, 2]);
    await vi.runAllTimersAsync();
    await work;
    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("does not schedule a delay for a small or empty scan", async () => {
    vi.useFakeTimers();
    const setTimer = vi.spyOn(globalThis, "setTimeout");
    const seen: string[] = [];
    await processInBatches([], item => seen.push(item), 2);
    await processInBatches(["photo", "video"], item => seen.push(item), 2);
    expect(seen).toEqual(["photo", "video"]);
    expect(setTimer).not.toHaveBeenCalled();
    setTimer.mockRestore();
  });

  it("propagates conversion failures instead of publishing incomplete results", async () => {
    await expect(processInBatches([1, 2, 3], id => {
      if (id === 2) throw new Error("invalid record");
    })).rejects.toThrow("invalid record");
  });
});
