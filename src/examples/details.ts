import type { Example } from "./index";
import { exampleMetadata } from "./metadata";

/** Preserve authored order, summaries and tag exclusions; never add entries to a supplied catalog. */
export const withExampleDetails = (catalog: readonly Example[]): Example[] =>
  catalog.map((example) => {
    const info = { ...example, ...(!example.localOnly ? exampleMetadata[example.slug] : undefined) };
    return { ...info, shows: info.shows?.filter((tag) => !info.omitShows?.includes(tag)) };
  });
