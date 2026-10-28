/** The languages this build offers, each a lazy catalog (scripts/i18n-plugin.ts). */
declare module "virtual:i18n/catalogs" {
  /** A compiled catalog by message number (src/i18n/index.ts's Catalog). */
  export const catalogs: Record<string, () => Promise<{ default: Record<number, unknown> }>>;
  export const coreCatalogs: typeof catalogs;
  export const surfaceCatalogs: Record<
    string,
    Partial<Record<import("./bucketManifest").SurfaceCatalog, (typeof catalogs)[string]>>
  >;
  /** Languages a person has reviewed; the rest are machine-translated. */
  export const reviewed: string[];
}
