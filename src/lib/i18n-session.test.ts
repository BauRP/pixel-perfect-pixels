import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("language choice when Android WebView storage is unavailable", () => {
  it("keeps manual language in the session even when localStorage throws", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); },
    });
    const { getLang, hasLang, setLang } = await import("./i18n");
    setLang("kk");
    expect(getLang()).toBe("kk");
    expect(hasLang()).toBe(true);
    setLang("ru");
    expect(getLang()).toBe("ru");
  });

  it("keeps a valid saved choice and never replaces it by detection", async () => {
    vi.resetModules();
    let saved = "ar";
    vi.stubGlobal("localStorage", {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value; },
    });
    const { ensureLangResolved, setLang, getLang } = await import("./i18n");
    expect(ensureLangResolved()).toBe("ar");
    setLang("kk");
    expect(ensureLangResolved()).toBe("kk");
    expect(getLang()).toBe("kk");
  });
});
