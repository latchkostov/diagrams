import type { EnrichedExample, ExampleIdentity } from "./index";
import { exampleMetadata } from "./metadata";

/** Preserve authored order, summaries and tag exclusions; never add entries to a supplied catalog. */
export const withExampleDetails = (catalog: readonly ExampleIdentity[]): EnrichedExample[] =>
  catalog.map((example) => {
    const info: EnrichedExample = example.localOnly ? example : { ...example, ...exampleMetadata[example.slug] };
    return { ...info, shows: info.shows?.filter((tag) => !info.omitShows?.includes(tag)) };
  });
