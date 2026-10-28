import { getLocale } from "./core";
import type { SurfaceCatalog } from "./load";
export type { SurfaceCatalog } from "./load";

export const usedCatalogs = new Set<SurfaceCatalog>();

/** Optional strings share their surface's loading, cancellation and retry lifecycle. */
export function surfaceCatalogs(buckets: readonly SurfaceCatalog[]): Promise<void> | undefined {
  buckets.forEach((bucket) => usedCatalogs.add(bucket));
  if (!buckets.length || getLocale() === "en") return;
  return import("./load").then((m) => m.loadSurfaceCatalogs(buckets));
}
