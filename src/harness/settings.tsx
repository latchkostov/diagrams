import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_NODE_VARIANT, isNodeVariantId, type NodeVariantId } from "./nodeVariants";
import { DEFAULT_EDGE_STYLE, isEdgeStyle, type EdgeStyle } from "./edgeStyles";

/**
 * Harness settings: the knobs the owner flips while iterating on the look.
 * Everything visual that has more than one implementation is selected here, so
 * swapping a renderer is "add an entry to a registry" + pick it in the top bar.
 */
export type Theme = "light" | "dark";

export interface Settings {
  nodeVariant: NodeVariantId;
  edgeStyle: EdgeStyle;
  theme: Theme;
}

interface SettingsApi extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const STORAGE_KEY = "diagrams.settings.v1";

function initialSettings(): Settings {
  const prefersDark =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const fallback: Settings = {
    nodeVariant: DEFAULT_NODE_VARIANT,
    edgeStyle: DEFAULT_EDGE_STYLE,
    theme: prefersDark ? "dark" : "light",
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      nodeVariant: isNodeVariantId(saved.nodeVariant) ? saved.nodeVariant : fallback.nodeVariant,
      edgeStyle: isEdgeStyle(saved.edgeStyle) ? saved.edgeStyle : fallback.edgeStyle,
      theme: saved.theme === "dark" || saved.theme === "light" ? saved.theme : fallback.theme,
    };
  } catch {
    return fallback;
  }
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(initialSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const api = useMemo(() => ({ ...settings, set }), [settings, set]);
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
