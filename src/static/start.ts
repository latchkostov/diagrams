import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../i18n/core";
import { browserLocale, chosenLocale, isRtl } from "../i18n/preferences";

/** Standalone scripts bundle their small catalog subset, including offline and file:// use. */
export async function startStaticPage(render: () => void): Promise<void> {
  const code = chosenLocale() ?? browserLocale();
  state.c = code === "en" ? undefined : ((await catalogs[code]?.())?.default as Catalog | undefined);
  state.l = code;
  // Leave English HTML (including whitespace and attributes) exactly as authored.
  if (code !== "en") {
    document.documentElement.lang = code;
    document.documentElement.dir = isRtl(code) ? "rtl" : "ltr";
    render();
  }
}
