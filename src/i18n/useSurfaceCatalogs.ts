import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { catalogsReady, catalogVersion, subscribeCatalogs, surfaceCatalogs, type SurfaceCatalog } from "./surfaces";
import { getLocale } from "./core";

export interface CatalogStatus {
  /** The buckets' messages are in for the language on screen. */
  ready: boolean;
  /** Their download failed for the language on screen (a language switch tries again). */
  failed: boolean;
  retry(): void;
}

/**
 * The readiness API (./surfaces.ts) for a component that stays mounted while its catalogs download: it starts the
 * download, re-renders when they're in, and re-targets on a language switch. `enabled` false: nothing to wait for.
 * Pass a literal list: the build's surface check (scripts/i18n-surfaces.ts) reads it.
 */
export function useSurfaceCatalogs(buckets: readonly SurfaceCatalog[], enabled = true): CatalogStatus {
  useSyncExternalStore(subscribeCatalogs, catalogVersion, catalogVersion);
  const locale = getLocale();
  const ready = !enabled || catalogsReady(buckets);
  // The language and attempt a failure belongs to: another language, or Retry, is a new attempt.
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const key = buckets.join(" ");
  const current = `${locale}#${attempt}`;
  useEffect(() => {
    if (ready) return;
    let live = true;
    surfaceCatalogs(key.split(" ") as SurfaceCatalog[])?.catch(() => {
      if (live) setFailure(current);
    });
    return () => {
      live = false;
    };
  }, [ready, key, current]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ready, failed: !ready && failure === current, retry };
}
