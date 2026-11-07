import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ nativeDelete: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ deleteOriginals: mock.nativeDelete }),
}));
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

describe("one outstanding system delete confirmation", () => {
  it("does not replace a pending delete with a second request", async () => {
    let finish!: (value: {deleted: string[]; failed: string[]}) => void;
    mock.nativeDelete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { deleteOriginals } = await import("./native-vault");
    const first = deleteOriginals(["content://media/one"]);
    expect(await deleteOriginals(["content://media/two"])).toEqual({
      deleted: [], failed: ["content://media/two"],
    });
    expect(mock.nativeDelete).toHaveBeenCalledTimes(1);
    finish({ deleted: ["content://media/one"], failed: [] });
    expect(await first).toEqual({ deleted: ["content://media/one"], failed: [] });
    mock.nativeDelete.mockResolvedValueOnce({ deleted: ["content://media/three"], failed: [] });
    expect(await deleteOriginals(["content://media/three"])).toEqual({
      deleted: ["content://media/three"], failed: [],
    });
    expect(mock.nativeDelete).toHaveBeenCalledTimes(2);
  });
  it("releases the guard after an OS rejection", async () => {
    mock.nativeDelete.mockRejectedValueOnce(new Error("denied"));
    const { deleteOriginals } = await import("./native-vault");
    expect(await deleteOriginals(["content://media/one"])).toEqual({
      deleted: [], failed: ["content://media/one"],
    });
    mock.nativeDelete.mockResolvedValueOnce({ deleted: ["content://media/two"], failed: [] });
    expect(await deleteOriginals(["content://media/two"])).toEqual({
      deleted: ["content://media/two"], failed: [],
    });
  });
});
