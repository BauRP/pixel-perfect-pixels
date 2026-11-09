import { describe, expect, it, vi } from "vitest";
import { createSingleFlightRefresh } from "./single-flight-refresh";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("bounded native snapshot scheduling", () => {
  it("coalesces a burst into one running and one latest request", async () => {
    const finish: Array<() => void> = [];
    const task = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
    const refresh = createSingleFlightRefresh(task);

    for (let i = 0; i < 100; i++) refresh();
    await tick();
    expect(task).toHaveBeenCalledTimes(1);
    finish.shift()?.();
    await tick();
    expect(task).toHaveBeenCalledTimes(2);
    finish.shift()?.();
    await tick();
    expect(task).toHaveBeenCalledTimes(2);
    refresh();
    await tick();
    expect(task).toHaveBeenCalledTimes(3);
    finish.shift()?.();
  });

  it("does not permanently block after native rejection", async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error("activity destroyed"))
      .mockResolvedValue(undefined);
    const refresh = createSingleFlightRefresh(task);
    refresh();
    refresh();
    await tick();
    await tick();
    expect(task).toHaveBeenCalledTimes(2);
    refresh();
    await tick();
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("does not discard a pending latest event during a busy operation", async () => {
    let finish!: () => void;
    const task = vi.fn().mockImplementationOnce(() =>
      new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const refresh = createSingleFlightRefresh(task);
    refresh();
    await tick();
    for (let i = 0; i < 200; i++) refresh();
    expect(task).toHaveBeenCalledTimes(1);
    finish();
    await tick();
    expect(task).toHaveBeenCalledTimes(2);
  });
});
