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
