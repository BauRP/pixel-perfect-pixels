import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { ru } from "./locales/ru";
import { kk } from "./locales/kk";
import { pt } from "./locales/pt";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { ar } from "./locales/ar";
import { zh } from "./locales/zh";
import { ko } from "./locales/ko";
import { ja } from "./locales/ja";
import { de } from "./locales/de";
import { it } from "./locales/it";
import { tr } from "./locales/tr";
import { pl } from "./locales/pl";
import { hi } from "./locales/hi";
import { vi } from "./locales/vi";
import { id } from "./locales/id";

const dictionaries = { en, ru, kk, pt, es, fr, ar, zh, ko, ja, de, it, tr, pl, hi, vi, id };
const canonicalKeys = Object.keys(en).sort();
const placeholders = (str: string) => [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("all 17 gallery locale dictionaries", () => {
  it("define every canonical key and never use blank strings", () => {
    for (const [lang, dictionary] of Object.entries(dictionaries)) {
      const actual = dictionary as Record<string, string>;
      expect(Object.keys(actual).sort(), lang).toEqual(canonicalKeys);
      for (const key of canonicalKeys) {
        expect(actual[key]?.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("preserve variable placeholders for destructive actions and messages", () => {
    for (const [lang, dictionary] of Object.entries(dictionaries)) {
      const actual = dictionary as Record<string, string>;
      for (const key of canonicalKeys) {
        expect(placeholders(actual[key]), `${lang}.${key}`)
          .toEqual(placeholders((en as Record<string, string>)[key]));
      }
    }
  });
});
