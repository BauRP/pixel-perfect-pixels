import { describe, expect, it, vi } from "vitest";
import { commitStateAfterPersistence, isSafeVaultId, isSafeVaultBlobPath } from "./vault-transaction";

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
    for(const raw of ["{", "null", "[]", "{}", '{"theme":"light"}',
      '{"folders":{}}', '{"folders":[{"id":"a","files":"broken"}]}',
      '{"folders":[{"files":[]}]}',
      '{"folders":[{"id":"a","files":[]},{"id":"a","files":[]}]}',
      '{"crypto":"broken"}']) {
      expect(() => parseVaultMetadata(raw, defaults)).toThrow();
    }
  });
});

describe("Safe file path confinement and metadata integrity", () => {
  it("accepts old and UUID identifiers but rejects traversal", () => {
    for (const s of ["safe", "1ff6a582-6f26-4ed4-b5af-75e9001b9abe", "folder_1"])
      expect(isSafeVaultId(s)).toBe(true);
    for (const s of ["", ".", "..", "../tmp", "/tmp", "folder/file", "a\\b", "a".repeat(129)])
      expect(isSafeVaultId(s)).toBe(false);
  });
  it("only accepts encrypted blob paths within the private Safe root", () => {
    expect(isSafeVaultBlobPath("nova_vault/folder_1/file-1.enc")).toBe(true);
    for (const s of ["../other.xml", "nova_vault/../other.xml",
      "nova_vault/folder/../../other.xml", "/nova_vault/a/b.enc",
      "nova_vault/a/b.jpg", "nova_vault/a/b.enc/extra"])
      expect(isSafeVaultBlobPath(s)).toBe(false);
  });
  it("does not accept truncated encrypted-file records as an empty Safe", async () => {
    const { parseVaultMetadata } = await import("./vault-transaction");
    const defaults = { folders: [] as unknown[], crypto: null, unlocked: false };
    const file = { id: "file1", name: "photo", iv: "b64", cipher: "payload" };
    for (const broken of [
      { ...file, id: "../prefs" }, { ...file, iv: "" },
      { ...file, cipher: undefined }, { ...file, blobPath: "../other.xml" },
    ]) {
      expect(() => parseVaultMetadata(JSON.stringify({
        folders: [{ id: "folder1", files: [broken] }], crypto: null,
      }), defaults)).toThrow();
    }
    expect(() => parseVaultMetadata('{"folders":[{"id":"../other","files":[]}]}', defaults)).toThrow();
    expect(parseVaultMetadata('{"folders":[],"crypto":null}', defaults).folders).toEqual([]);
  });
});
