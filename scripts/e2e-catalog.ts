import { catalogBuckets } from "../src/i18n/bucketManifest";

/** Match a language download in the production bundle or Vite's virtual modules. */
export const catalogRequest = (code: string, buckets = Object.keys(catalogBuckets).join("|")) =>
  new RegExp(
    String.raw`/(?:assets/${code}-(?:${buckets})-[\w-]+\.js|@id/__x00__virtual:i18n/catalog/${code}-(?:${buckets}))(?:\?|$)`,
  );
