import { describe, expect, it, vi } from "vitest";
import { commitStateAfterPersistence } from "./vault-transaction";

describe("encrypted Safe metadata transactions", () => {
  it("persists the next metadata before reporting committed state", () => {
    const prior = { folders: ["existing"] };
    const saves: string[][] = [];
    const result = commitStateAfterPersistence(
      prior, s => ({ folders: [...s.folders, "new"] }),
      next => { saves.push([...next.folders]); },
    );
    expect(prior.folders).toEqual(["existing"]);
    expect(saves).toEqual([["existing", "new"]]);
    expect(result.folders).toEqual(["existing", "new"]);
  });
  it("propagates disk/quota failure and leaves prior index unchanged", () => {
    const prior = { folders: [{ id: "safe", files: ["encrypted-photo"] }] };
    const persist = vi.fn(() => { throw new Error("storage quota"); });
    expect(() => commitStateAfterPersistence(
      prior, s => ({ folders: s.folders.map(f => ({ ...f, files: [] })) }),
      persist,
    )).toThrow("storage quota");
    expect(prior.folders[0].files).toEqual(["encrypted-photo"]);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe("Safe metadata corruption protection", () => {
  it("preserves a legacy optional-field record without restoring unlocked state", async () => {
    const { parseVaultMetadata } = await import("./vault-transaction");
    const defaults = { folders: [] as {id:string; files:unknown[]}[], unlocked: false, theme: "dark" };
    const value = parseVaultMetadata('{"folders":[{"id":"a","files":[]}],"unlocked":true}', defaults);
    expect(value.folders).toHaveLength(1);
    expect(value.unlocked).toBe(false);
    expect(value.theme).toBe("dark");
  });
  it("refuses malformed metadata rather than overwriting the Safe index", async () => {
    const { parseVaultMetadata } = await import("./vault-transaction");
    const defaults = { folders: [] as unknown[], unlocked: false };
    for(const raw of ["{", "null", "[]", '{"folders":{}}',
      '{"folders":[{"id":"a","files":"broken"}]}', '{"crypto":"broken"}']) {
      expect(() => parseVaultMetadata(raw, defaults)).toThrow();
    }
  });
});
