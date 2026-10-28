import { coreCatalogs as catalogs } from "virtual:i18n/catalogs";
import { safeStorage } from "../lib/storage";
import { LOCALES } from "../lib/deployment";
import { LOCALE_KEY } from "./core";

/**
 * The languages offered, the default first: English, then every compiled catalog (scripts/i18n-plugin.ts). A copy
 * built with VITE_LOCALES offers those, in that order; its first is the default when nothing else matches.
 */
export const available: readonly string[] = LOCALES ? LOCALES.split(",") : ["en", ...Object.keys(catalogs)];

const maximize = (tag: string) => {
  try {
    return new Intl.Locale(tag).maximize();
  } catch {
    return undefined;
  }
};

/**
 * The best offered language for the browser's preferences (navigator.languages, most preferred first), in the way
 * operating systems fall back: the same language and region (pt-BR), the same language and script (de-AT reads de,
 * zh-HK reads zh-TW, which is Traditional), then the same language in another script (sr-Cyrl reads sr-Latn). The
 * first preference with any match wins; then the default.
 */
export function resolveLocale(prefs: readonly string[], offered: readonly string[] = available): string {
  const known = offered.flatMap((code) => {
    const m = maximize(code);
    return m ? [{ code, m }] : [];
  });
  for (const pref of prefs) {
    // Norwegian: Nynorsk and the old "no" read Bokmål, the one written by every platform.
    const m = maximize(pref.replace(/^(?:no|nn)(?=$|-)/i, "nb"));
    if (!m) continue;
    const language = known.filter((o) => o.m.language === m.language);
    if (!language.length) continue;
    const script = language.filter((o) => o.m.script === m.script);
    const exact = script.find((o) => o.m.region === m.region);
    if (exact) return exact.code;
    // Portuguese outside Brazil (Portugal, Angola, Mozambique…) is written the European way.
    const european = m.language === "pt" && script.find((o) => o.m.region === "PT");
    if (european) return european.code;
    return (script[0] ?? language[0]).code;
  }
  return offered[0] ?? "en";
}

/** The language the browser asks for, among those offered. */
export const browserLocale = (): string => resolveLocale(navigator.languages);

/** The person's own choice, if they made one and this copy still offers it; null means "Browser default". */
export function chosenLocale(): string | null {
  const stored = safeStorage.getItem(LOCALE_KEY);
  return stored && available.includes(stored) ? stored : null;
}

/** Arabic, Hebrew, Persian and Urdu read right to left: the chrome mirrors (the diagram doesn't). */
export const isRtl = (code: string) => /^(ar|he|fa|ur)\b/.test(code);
