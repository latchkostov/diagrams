import { useCallback, useEffect, useInsertionEffect, useMemo, useState, type ReactNode } from "react";
import { initialSettings, SettingsContext, STORAGE_KEY, type Settings, type Theme } from "./settings";
import { safeStorage } from "../lib/storage";

export function SettingsProvider({ children, theme }: { children: ReactNode; theme?: Theme }) {
  const [stored, setSettings] = useState<Settings>(initialSettings);
  const settings = useMemo(() => (theme ? { ...stored, theme } : stored), [stored, theme]);

  useEffect(() => {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Publish CSS tokens before descendant layout/effects measure caption contrast or read live colours.
  useInsertionEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings.theme]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => {
      const next = { ...s, [key]: value };
      if (key === "theme") next.themePreference = value as Theme;
      if (key === "themePreference")
        next.theme =
          value === "system"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : (value as Theme);
      return next;
    });
  }, []);

  useEffect(() => {
    if (theme || stored.themePreference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = (event: MediaQueryListEvent) =>
      setSettings((current) =>
        current.themePreference === "system" ? { ...current, theme: event.matches ? "dark" : "light" } : current,
      );
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [stored.themePreference, theme]);

  const api = useMemo(() => ({ ...settings, set }), [settings, set]);
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}
