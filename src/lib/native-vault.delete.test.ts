import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ nativeDelete: vi.fn(), nativeRestore: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ deleteOriginals: mock.nativeDelete, restoreFile: mock.nativeRestore }),
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
  it("accepts only actually requested native deletion confirmations", async () => {
    mock.nativeDelete.mockResolvedValueOnce({
      deleted: ["content://media/one", "content://media/foreign"],
      failed: [],
    });
    const { deleteOriginals } = await import("./native-vault");
    expect(await deleteOriginals(["content://media/one", "content://media/two"])).toEqual({
      deleted: ["content://media/one"],
      failed: ["content://media/two"],
    });
  });
  it("treats malformed native delete replies as unconfirmed, then permits retry", async () => {
    mock.nativeDelete.mockResolvedValueOnce({ deleted: null, failed: [] });
    const { deleteOriginals } = await import("./native-vault");
    expect(await deleteOriginals(["content://media/one"])).toEqual({
      deleted: [], failed: ["content://media/one"],
    });
    mock.nativeDelete.mockResolvedValueOnce({
      deleted: ["content://media/one"], failed: [],
    });
    expect(await deleteOriginals(["content://media/one"])).toEqual({
      deleted: ["content://media/one"], failed: [],
    });
  });

});

describe("native restore acknowledgement", () => {
  const request = {base64: "AQID", name: "photo.jpg", mime: "image/jpeg"};
  it("accepts published scoped URI and legacy absolute paths", async () => {
    const { restoreToPublic } = await import("./native-vault");
    mock.nativeRestore.mockResolvedValueOnce({path:"content://media/external/images/media/77"});
    await expect(restoreToPublic(request)).resolves.toBe("content://media/external/images/media/77");
    mock.nativeRestore.mockResolvedValueOnce({path:"/storage/emulated/0/DCIM/photo.jpg"});
    await expect(restoreToPublic(request)).resolves.toBe("/storage/emulated/0/DCIM/photo.jpg");
    mock.nativeRestore.mockResolvedValueOnce({path:"content://media/external_primary/video/media/321"});
    await expect(restoreToPublic(request)).resolves.toBe("content://media/external_primary/video/media/321");
  });
  it("rejects fake and missing receipts so the Safe original is retained", async () => {
    const { restoreToPublic } = await import("./native-vault");
    for (const value of [{path:"ok"},{path:""},{},null,
      {path:"content://evilprovider/secret/1"},
      {path:"content://media/external/images/media/not-an-id"},
      {path:"content://media/external/images/media/1?anything"},
      {path:"/data/data/app.private/secret.jpg"},
      {path:"/"},
      {path:"/storage/emulated/0/../private.jpg"},
      {path:"/storage/emulated/0//Pictures/photo.jpg"}]) {
      mock.nativeRestore.mockResolvedValueOnce(value);
      await expect(restoreToPublic(request)).rejects.toThrow("did not confirm");
    }
  });
});
