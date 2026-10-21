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
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const api = useMemo(() => ({ ...settings, set }), [settings, set]);
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}
