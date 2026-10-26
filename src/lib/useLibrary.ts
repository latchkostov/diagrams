import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DIAGRAMS_CHANGED,
  getShared,
  LIBRARY_KEY,
  listLibrary,
  migrateLegacySlot,
  warnIfNearlyFull,
  type LibraryEntry,
} from "./diagramIO";
import type { DiagramFile } from "../model/types";

/** Storage keys whose changes (in this tab or another) refresh the library. */
const WATCHED = [LIBRARY_KEY, "diagrams.shared.v1", "diagrams.imported.v1"];

/**
 * Your diagrams and the shared slot, re-read whenever they change: in this tab (DIAGRAMS_CHANGED)
 * or in another one (the storage event). Upgrades the old single slot on first use.
 */
export function useLibrary(): {
  entries: LibraryEntry[];
  shared: DiagramFile | undefined;
  /** Re-reads now (e.g. before showing the list: autosaves update the index without a re-render). */
  refresh: () => void;
} {
  const [version, setVersion] = useState(() => {
    migrateLegacySlot();
    return 0;
  });
  useEffect(() => {
    const bump = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail === false) return;
      setVersion((v) => v + 1);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || WATCHED.includes(e.key)) bump();
    };
    window.addEventListener(DIAGRAMS_CHANGED, bump);
    window.addEventListener("storage", onStorage);
    // A library close to the browser's limit says so once, early.
    const t = window.setTimeout(() => warnIfNearlyFull(), 1500);
    return () => {
      window.removeEventListener(DIAGRAMS_CHANGED, bump);
      window.removeEventListener("storage", onStorage);
      window.clearTimeout(t);
    };
  }, []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return useMemo(() => {
    void version; // re-read on every change
    return { entries: listLibrary(), shared: getShared(), refresh };
  }, [version, refresh]);
}
