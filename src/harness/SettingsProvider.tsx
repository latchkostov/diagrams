import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { initialSettings, SettingsContext, STORAGE_KEY, type Settings } from "./settings";
import { safeStorage } from "../lib/storage";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(initialSettings);

  useEffect(() => {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const api = useMemo(() => ({ ...settings, set }), [settings, set]);
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}
