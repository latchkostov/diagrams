import { safeStorage } from "../lib/storage";
import { useCallback, useEffect, useState } from "react";
import type { EditorPrefs } from "./types";

const KEY = "diagrams.editor.v1";

function initial(): EditorPrefs {
  const fallback: EditorPrefs = {
    snap: true,
    grid: true,
    minimap: false,
    inspector: typeof window === "undefined" || window.innerWidth >= 1280,
  };
  try {
    const saved = JSON.parse(safeStorage.getItem(KEY) ?? "null") as Partial<EditorPrefs> | null;
    if (!saved) return fallback;
    const pick = (k: keyof EditorPrefs) => (typeof saved[k] === "boolean" ? saved[k] : fallback[k]);
    return { snap: pick("snap"), grid: pick("grid"), minimap: pick("minimap"), inspector: pick("inspector") };
  } catch {
    return fallback;
  }
}

/** Canvas view preferences, persisted per browser. */
export function useEditorPrefs(): [EditorPrefs, <K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]) => void] {
  const [prefs, setPrefs] = useState(initial);
  useEffect(() => {
    safeStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);
  const set = useCallback(
    <K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]) => setPrefs((p) => ({ ...p, [key]: value })),
    [],
  );
  return [prefs, set];
}
