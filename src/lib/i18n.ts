// Application-wide internationalization.
//
//  - 17 fully translated locales, each in its own file under ./locales.
//  - First launch: the device / browser locale is detected, mapped to an ISO
//    language code and matched against the supported list. Anything unknown
//    (or undetectable) falls back to English.
//  - The resolved language is persisted to localStorage immediately, so every
//    later launch uses the stored preference and auto-detection never runs
//    again (a manual choice in Settings is never overridden).
//  - Switching language re-renders every subscriber instantly via
//    useSyncExternalStore — no reload, no flicker.
//  - Arabic text flows RTL while document layout stays LTR.

import { useCallback, useSyncExternalStore } from "react";

import { en, type Translation, type TranslationKey } from "./locales/en";
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

export type { TranslationKey };

export type Lang =
  | "en" | "ru" | "kk" | "pt" | "es" | "fr" | "ar" | "zh" | "ko"
  | "ja" | "de" | "it" | "tr" | "pl" | "hi" | "vi" | "id";

export const DEFAULT_LANG: Lang = "en";

/** Native display names (autonyms) shown in the Settings dropdown. */
export const LANGS: { code: Lang; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "kk", label: "Kazakh", native: "Қазақ тілі" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "fr", label: "French", native: "Français" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "zh", label: "Chinese", native: "中文" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "pl", label: "Polish", native: "Polski" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
];

const DICTS: Record<Lang, Translation> = {
  en, ru, kk, pt, es, fr, ar, zh, ko, ja, de, it, tr, pl, hi, vi, id,
};

/** Locales written right-to-left. */
export const RTL_LANGS: Lang[] = ["ar"];
export const isRtl = (l: Lang) => RTL_LANGS.includes(l);

const SUPPORTED = new Set<string>(LANGS.map((l) => l.code));
const KEY = "vault.lang";

let listeners: (() => void)[] = [];
const emit = () => listeners.forEach((l) => l());

function isLang(v: unknown): v is Lang {
  return typeof v === "string" && SUPPORTED.has(v);
}

/**
 * Normalize any BCP-47 / POSIX locale tag to a bare ISO language code:
 * "ru-RU" → "ru", "kk_KZ.UTF-8" → "kk", "zh-Hans-CN" → "zh",
 * "pt-BR" → "pt", "in" (legacy Indonesian) → "id".
 */
export function normalizeLocale(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().replace(/_/g, "-").split(".")[0]?.split("-")[0];
  if (!base) return null;
  const legacy: Record<string, Lang> = { in: "id", iw: "en", ji: "en", zh: "zh" };
  const code = legacy[base] ?? base;
  return isLang(code) ? code : null;
}

/** All locale tags the device reports, most-preferred first. */
function deviceLocales(): string[] {
  if (typeof navigator === "undefined") return [];
  const nav = navigator as Navigator & { userLanguage?: string };
  const out: string[] = [];
  if (Array.isArray(nav.languages)) out.push(...nav.languages);
  if (nav.language) out.push(nav.language);
  if (nav.userLanguage) out.push(nav.userLanguage);
  return out.filter(Boolean);
}

/** Detected device language, or English when unknown / undetectable. */
export function detectDeviceLang(): Lang {
  for (const tag of deviceLocales()) {
    const match = normalizeLocale(tag);
    if (match) return match;
  }
  return DEFAULT_LANG;
}

export function hasLang(): boolean {
  if (typeof window === "undefined") return false;
  try { return isLang(localStorage.getItem(KEY)); } catch { return false; }
}

export function getLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const stored = localStorage.getItem(KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function setLang(l: Lang) {
  const next: Lang = isLang(l) ? l : DEFAULT_LANG;
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  applyDocumentDirection(next);
  emit();
}

/** Mark the active language for text formatting without mirroring the app layout. */
export function applyDocumentDirection(l: Lang = getLang()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("lang", l);
  root.setAttribute("dir", "ltr");
}

/**
 * First-launch resolution. Runs once per install: detect → map → persist.
 * A stored preference always wins, so a manual pick is never overridden.
 */
export function ensureLangResolved(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  if (hasLang()) {
    const stored = getLang();
    applyDocumentDirection(stored);
    return stored;
  }
  const detected = detectDeviceLang();
  setLang(detected);
  return detected;
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((x) => x !== cb); };
}

export function useLang(): [Lang, (l: Lang) => void] {
  const l = useSyncExternalStore(subscribe, getLang, () => DEFAULT_LANG);
  return [l, setLang];
}

export function useIsRtl(): boolean {
  const [l] = useLang();
  return isRtl(l);
}

/** Fill `{name}` placeholders. */
function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_m, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function translate(
  lang: Lang, key: TranslationKey, vars?: Record<string, string | number>,
): string {
  const dict = DICTS[lang] ?? en;
  return interpolate(dict[key] ?? en[key], vars);
}

export type TFunction = (
  key: TranslationKey, vars?: Record<string, string | number>,
) => string;

export function useT(): TFunction {
  const [lang] = useLang();
  return useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(lang, key, vars),
    [lang],
  );
}
