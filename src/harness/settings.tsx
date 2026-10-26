import { safeStorage } from "../lib/storage";
import { createContext, useContext } from "react";
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
  libraryPinned?: boolean;
}

interface SettingsApi extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export const STORAGE_KEY = "diagrams.settings.v1";

export function initialSettings(): Settings {
  const prefersDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const fallback: Settings = {
    nodeVariant: DEFAULT_NODE_VARIANT,
    edgeStyle: DEFAULT_EDGE_STYLE,
    theme: prefersDark ? "dark" : "light",
  };
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      nodeVariant: isNodeVariantId(saved.nodeVariant) ? saved.nodeVariant : fallback.nodeVariant,
      edgeStyle: isEdgeStyle(saved.edgeStyle) ? saved.edgeStyle : fallback.edgeStyle,
      theme: saved.theme === "dark" || saved.theme === "light" ? saved.theme : fallback.theme,
      libraryPinned: saved.libraryPinned === true,
    };
  } catch {
    return fallback;
  }
}

export const SettingsContext = createContext<SettingsApi | null>(null);

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
