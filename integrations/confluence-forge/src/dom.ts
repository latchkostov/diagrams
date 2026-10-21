import { t } from "../../../src/i18n/core";
import type { MacroConfig } from "./config";

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  testid: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.dataset.testid = testid;
  el.textContent = text;
  return el;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("viewerForge.bridgeError");
}

export function followTheme(
  config: MacroConfig,
  enable: () => Promise<void>,
  setTheme: (theme: "light" | "dark") => void = (theme) => {
    document.documentElement.dataset.theme = theme;
  },
): void {
  const root = document.documentElement;
  const update = () => {
    const host = root.dataset.colorMode;
    const theme = config.theme === "auto" ? (host === "dark" ? "dark" : "light") : config.theme;
    setTheme(theme);
  };
  update();
  // Forge injects data-color-mode and updates it when the reader changes Confluence's theme.
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ["data-color-mode"] });
  void enable()
    .then(update)
    .catch(() => {
      /* Older bridge: keep the light or explicit theme. */
    });
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}
