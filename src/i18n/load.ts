import { coreCatalogs as catalogs, surfaceCatalogs, reviewed } from "virtual:i18n/catalogs";
import { catalogsReady, markInstalled, resetInstalled, usedCatalogs, type SurfaceCatalog } from "./surfaces";
import { safeStorage } from "../lib/storage";
import { LOCALE_KEY, state, type Catalog } from "./index";

import { browserLocale, chosenLocale, isRtl } from "./preferences";
export { available, browserLocale, chosenLocale, isRtl, resolveLocale } from "./preferences";

// The lazy half of the runtime: which languages this copy offers, which one to use, and loading its catalog. It
// loads at startup only for someone whose language isn't English, and with the Language dialog.

/** Whether a person has checked this language's translation (the rest say they're machine-translated). */
export const isReviewed = (code: string) => code === "en" || reviewed.includes(code);

/**
 * Switches the language: `<html lang dir>`, the catalog (core plus the surface `buckets` merged into it), and every
 * component that shows text re-renders.
 */
export function setLocale(code: string, messages?: Catalog, buckets: Iterable<SurfaceCatalog> = []): void {
  state.l = code;
  state.c = messages;
  resetInstalled(code, buckets);
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

/** Surfaces already used must switch atomically with the shell. Failed requests are retryable. */
const parts = new Map<string, Promise<Catalog>>();
function catalogPart(code: string, bucket: SurfaceCatalog): Promise<Catalog> {
  const key = `${code}/${bucket}`;
  let pending = parts.get(key);
  if (!pending) {
    const load = surfaceCatalogs[code]?.[bucket];
    pending = (load ? load().then((m) => m.default as Catalog) : Promise.resolve({})).catch((error: unknown) => {
      parts.delete(key);
      throw error;
    });
    parts.set(key, pending);
  }
  return pending;
}

/** Resolves once the language on screen is no longer `code`. */
function leaving(code: string): { promise: Promise<undefined>; stop: () => void } {
  let stop = () => {};
  const promise = new Promise<undefined>((resolve) => {
    const check = () => {
      if (state.l !== code) resolve(undefined);
    };
    state.f.add(check);
    stop = () => void state.f.delete(check);
    check();
  });
  return { promise, stop };
}

/**
 * ./surfaces.ts's surfaceCatalogs: these buckets, for the language on screen. A language switch while they download
 * re-targets the wait to the new language (which the switch has downloaded them for already), so an obsolete request
 * neither holds the surface nor fails it. A failure for the language on screen rejects, unless a switch in progress
 * then replaces that language.
 */
export async function loadSurfaceCatalogs(buckets: readonly SurfaceCatalog[]): Promise<void> {
  buckets.forEach((bucket) => usedCatalogs.add(bucket));
  for (;;) {
    const code = state.l;
    if (catalogsReady(buckets, code)) return;
    const left = leaving(code);
    let messages: Catalog[] | undefined;
    try {
      messages = await Promise.race([Promise.all(buckets.map((bucket) => catalogPart(code, bucket))), left.promise]);
    } catch (error) {
      if (state.l === code) await switching?.catch(() => {});
      if (state.l === code && !catalogsReady(buckets, code)) throw error;
      continue;
    } finally {
      left.stop();
    }
    if (!messages || state.l !== code) continue;
    const additions = messages.filter((_messages, i) => !catalogsReady([buckets[i]], code));
    if (additions.length) state.c = Object.assign({}, state.c, ...additions);
    markInstalled(code, buckets);
    return;
  }
}

let request = 0;
/** The language switch in progress, if any. */
let switching: Promise<boolean> | undefined;

/**
 * Loads a language's catalog, then (only if no later call started meanwhile) runs `commit` and switches to it. True
 * when it switched, false when a later call superseded it. A failed download throws, unless superseded: nothing has
 * changed then, the language and the stored choice are still the previous ones.
 */
function apply(code: string, commit?: () => void): Promise<boolean> {
  const run = applying(code, commit);
  switching = run;
  const done = () => {
    if (switching === run) switching = undefined;
  };
  run.then(done, done);
  return run;
}
async function applying(code: string, commit?: () => void): Promise<boolean> {
  const mine = ++request;
  const load = catalogs[code];
  let messages: Catalog | undefined;
  let buckets: SurfaceCatalog[] = [];
  try {
    messages = load ? { ...((await load()).default as Catalog) } : undefined;
    if (messages) {
      // Surfaces opened while this downloads join it: the language never commits without their strings.
      do {
        buckets = [...usedCatalogs];
        const extras = await Promise.all(buckets.map((bucket) => catalogPart(code, bucket)));
        Object.assign(messages, ...extras);
      } while (buckets.length !== usedCatalogs.size);
    }
  } catch (error) {
    if (mine !== request) return false;
    throw error;
  }
  if (mine !== request) return false;
  commit?.();
  setLocale(code, messages, buckets);
  return true;
}

/** At startup (./start.ts's startI18n): the person's choice, else the browser's language. */
export const start = async (): Promise<void> => void (await apply(chosenLocale() ?? browserLocale()));

/**
 * The Language dialog's choice: a language, or null for the browser's. Kept in this browser once its catalog is in,
 * together with the switch, so the stored choice and the language on screen never disagree. Rejects when the
 * download fails (the language and the stored choice stay as they were); false when a later choice superseded it.
 */
export function chooseLocale(code: string | null): Promise<boolean> {
  return apply(code ?? browserLocale(), () =>
    code ? safeStorage.setItem(LOCALE_KEY, code) : safeStorage.removeItem(LOCALE_KEY),
  );
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
