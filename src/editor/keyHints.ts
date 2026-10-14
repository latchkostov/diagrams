import { getLocale } from "../i18n";
import { formatCombo, isMac } from "./shortcuts";

/** Preserve historical English prose hints; other languages use the OS's compact key labels. */
export function legacyKeyHint(combo: string): string {
  return getLocale() === "en" ? combo.replace("Mod", isMac() ? "⌘" : "Ctrl") : formatCombo(combo);
}
