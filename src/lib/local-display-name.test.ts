import { describe, expect, it } from "vitest";
import { localDisplayName, validLocalDisplayName } from "./local-display-name";

describe("gallery local labels survive an Android rescan", () => {
  it("uses the saved label while retaining the unchanged original item", () => {
    const item = {id:"content://media/external/file/5:50:100",name:"IMG_5.jpg"};
    const names = {"native:content://media/external/file/5":"Family.jpg"};
    expect(localDisplayName(item,names)).toBe("Family.jpg");
    expect(localDisplayName({...item,id:"content://media/external/file/5:100:200"},names))
      .toBe("Family.jpg");
    expect(item.name).toBe("IMG_5.jpg");
    expect(localDisplayName(item,{})).toBe(item.name);
  });
  it("rejects blank/unsafe labels without changing actual media files", () => {
    expect(validLocalDisplayName("   ")).toBeNull();
    expect(validLocalDisplayName("../secret")).toBeNull();
    expect(validLocalDisplayName("folder\\photo")).toBeNull();
    expect(validLocalDisplayName(" A photo.jpg ")).toBe("A photo.jpg");
    expect(validLocalDisplayName("x".repeat(121))).toBeNull();
  });
});
