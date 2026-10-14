import { catalogs, reviewed } from "virtual:i18n/catalogs";
import { safeStorage } from "../lib/storage";
import { LOCALES } from "../lib/deployment";
import { LOCALE_KEY, state, type Catalog } from "./index";

// The lazy half of the runtime: which languages this copy offers, which one to use, and loading its catalog. It
// loads at startup only for someone whose language isn't English, and with the Language dialog.

/**
 * The languages offered, the default first: English, then every compiled catalog (scripts/i18n-plugin.ts). A copy
 * built with VITE_LOCALES offers those, in that order; its first is the default when nothing else matches.
 */
export const available: readonly string[] = LOCALES ? LOCALES.split(",") : ["en", ...Object.keys(catalogs)];

/** Whether a person has checked this language's translation (the rest say they're machine-translated). */
export const isReviewed = (code: string) => code === "en" || reviewed.includes(code);

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

/** Switches the language: `<html lang dir>`, the catalog, and every component that shows text re-renders. */
export function setLocale(code: string, messages?: Catalog): void {
  state.l = code;
  state.c = messages;
  state.a = code === "en" ? undefined : relativeAgo(code);
  const root = document.documentElement;
  root.lang = code;
  root.dir = isRtl(code) ? "rtl" : "ltr";
  state.f.forEach((f) => f());
}

/** formatAgo (./format.ts) in a language other than English: installed with the language, so the entry carries none of it. */
export function relativeAgo(code: string): (at: number, now?: number) => string {
  const rtf = new Intl.RelativeTimeFormat(code, { numeric: "auto", style: "short" });
  return (at, now = Date.now()) => {
    const s = Math.max(0, (now - at) / 1000);
    if (s < 45) return rtf.format(0, "second");
    if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), "minute");
    if (s < 86_400) return rtf.format(-Math.round(s / 3600), "hour");
    if (s < 2 * 86_400) return rtf.format(-1, "day");
    return new Date(at).toLocaleDateString(code, { day: "numeric", month: "short" });
  };
}

/** Arabic, Hebrew, Persian and Urdu read right to left: the chrome mirrors (the diagram doesn't). */
export const isRtl = (code: string) => /^(ar|he|fa|ur)\b/.test(code);

let request = 0;

/** Loads a language's catalog and switches to it (the latest call wins when several overlap). */
async function apply(code: string): Promise<void> {
  const mine = ++request;
  const load = catalogs[code];
  const messages = load ? ((await load()).default as Catalog) : undefined;
  if (mine === request) setLocale(code, messages);
}

/** At startup (./start.ts's startI18n): the person's choice, else the browser's language. */
export const start = (): Promise<void> => apply(chosenLocale() ?? browserLocale());

/** The Language dialog's choice: a language, or null for the browser's. Remembered in this browser. */
export async function chooseLocale(code: string | null): Promise<void> {
  if (code) safeStorage.setItem(LOCALE_KEY, code);
  else safeStorage.removeItem(LOCALE_KEY);
  await apply(code ?? browserLocale());
}

/** A language's name: in its own language (`of`) or in another (`in`). "zh-CN" reads as Simplified Chinese. */
export function languageName(code: string, inLanguage = code): string {
  const tag = code === "zh-CN" ? "zh-Hans" : code === "zh-TW" ? "zh-Hant" : code;
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: "language", languageDisplay: "standard" }).of(tag);
    // Many languages write their names in lower case (français, español); a list item starts with a capital.
    return name ? name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** View ▸ Language… and Ctrl+K: the dialog, which mounts on its own (src/components/LanguageDialog.tsx). */
export const openLanguageDialog = () => import("./languageDialogRoot").then((m) => m.showLanguageDialog());

/** Where a correction goes: a prefilled issue in the public repository, so it needs nothing but a GitHub account. */
export function suggestUrl(code: string): string {
  const name = languageName(code, "en");
  // In English: it's for the maintainers, on GitHub.
  const params = new URLSearchParams({
    title: `Translation (${name}, ${code}): `,
    labels: "translation",
    body: [
      `Language: ${name} (${code})`,
      "Where in the app (menu, dialog, button):",
      "What it says now:",
      "What it should say:",
      "",
      "Translations live in src/i18n/locales; how they're made and checked: docs/I18N.md.",
    ].join("\n"),
  });
  return `https://github.com/latchkostov/diagrams/issues/new?${params}`;
}
