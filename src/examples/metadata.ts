import type { Thumb } from "../lib/thumbnail";

export interface ExampleMetadata {
  title: string;
  description?: string;
  thumb: Thumb;
  /** Stable feature IDs, translated by the gallery (docs/EXAMPLES.md). */
  shows?: string[];
  /** First saved simulation; absent when this example has none. */
  simulation?: string;
}

// Replaced from public JSON files by exampleMetadataPlugin in dev, tests and builds.
export const exampleMetadata: Record<string, ExampleMetadata> = {};
