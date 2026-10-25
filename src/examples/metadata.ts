import type { Thumb } from "../lib/thumbnail";

export interface ExampleMetadata {
  description?: string;
  thumb: Thumb;
  /** Stable feature IDs, translated by the gallery (docs/EXAMPLES.md). */
  shows?: string[];
}

// Replaced from public JSON files by exampleMetadataPlugin in dev, tests and builds.
export const exampleMetadata: Record<string, ExampleMetadata> = {};
