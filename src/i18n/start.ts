import { safeStorage } from "../lib/storage";
import { LOCALES } from "../lib/deployment";
import { LOAD_FAILED } from "../lib/lazyLoad";
import { notify } from "../interop/ui/toast";
import { LOCALE_KEY } from "./index";

// Starting in the person's language, and the way to the lazy half of the runtime (./load.ts). It ends up in the entry;
// ./index.ts, the lookup itself, is a small startup chunk of its own (src/lib/bundleSplit.build.test.ts).

/**
 * Starts in the person's language, before the first render. English (the source): nothing to load. Otherwise the
 * loader and the core catalog download first, so the app never shows English and then switches.
 */
export function startI18n(): Promise<void> | undefined {
  const want = safeStorage.getItem(LOCALE_KEY) ?? navigator.language;
  // A copy built for some languages only (VITE_LOCALES, src/lib/deployment.ts) may not have English.
  if (/^en\b(?!-XA)/.test(want) && (!LOCALES || /\ben\b/.test(LOCALES))) return;
  return loadI18n().then((m) => m.start());
}

/** The lazy half (./load.ts): the language list, switching, and the Language dialog's opener. */
export const loadI18n = () => import("./load");

/** View ▸ Language… and Ctrl+K's Language…: the list and the dialog load when it opens (the list as the View menu does). */
export const openLanguageDialog = () =>
  void loadI18n()
    .then((m) => m.openLanguageDialog())
    .catch(() => notify(LOAD_FAILED, { kind: "error" }));
