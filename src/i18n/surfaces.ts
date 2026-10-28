import { getLocale, state } from "./core";
import type { SurfaceCatalog } from "./bucketManifest";
export type { SurfaceCatalog } from "./bucketManifest";

// The one catalog-readiness API (docs/I18N.md, "Catalog loading boundaries"). A surface declares the optional
// catalogs it renders with a literal list: `await surfaceCatalogs([...])` in its loader, or `useSurfaceCatalogs([...])`
// (./useSurfaceCatalogs.ts) in a component that stays mounted. scripts/i18n-surfaces.ts reads those lists at build
// time and fails when a module can render a key that neither core nor a declared catalog contains.
//
// Readiness is per language: `${locale}/${bucket}` is in once that bucket's messages are in the catalog on screen.
// React-free, small and shared: the loading half is ./load.ts, imported only when something is missing.

/** Every bucket a surface has asked for: a language switch downloads them before it commits (./load.ts). */
export const usedCatalogs = new Set<SurfaceCatalog>();
const installed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

/** Whether these buckets' messages are in the catalog for `locale` (the language on screen by default). */
export function catalogsReady(buckets: readonly SurfaceCatalog[], locale = getLocale()): boolean {
  return locale === "en" || (locale === state.l && buckets.every((bucket) => installed.has(`${locale}/${bucket}`)));
}

/** ./load.ts: a new language's catalog, with these buckets in. Its setLocale notifies. */
export function resetInstalled(locale: string, buckets: Iterable<SurfaceCatalog>): void {
  installed.clear();
  for (const bucket of buckets) installed.add(`${locale}/${bucket}`);
  version++;
}

/** ./load.ts: these buckets were added to the catalog on screen. */
export function markInstalled(locale: string, buckets: readonly SurfaceCatalog[]): void {
  for (const bucket of buckets) installed.add(`${locale}/${bucket}`);
  version++;
  listeners.forEach((f) => f());
}

/** Re-runs `f` when a language or a catalog is installed. */
export function subscribeCatalogs(f: () => void): () => void {
  listeners.add(f);
  state.f.add(f);
  return () => {
    listeners.delete(f);
    state.f.delete(f);
  };
}

/** Changes whenever readiness may have: the language, or a catalog installed. */
export const catalogVersion = () => `${state.l}#${version}`;

/**
 * Optional strings share their surface's loading, cancellation and retry lifecycle: undefined when they're in, else
 * a promise that settles once they are for the language on screen. A language switch while it waits re-targets it to
 * the new language; only a failure for the language still on screen rejects.
 */
export function surfaceCatalogs(buckets: readonly SurfaceCatalog[]): Promise<void> | undefined {
  buckets.forEach((bucket) => usedCatalogs.add(bucket));
  if (catalogsReady(buckets)) return;
  return import("./load").then((m) => m.loadSurfaceCatalogs(buckets));
}
