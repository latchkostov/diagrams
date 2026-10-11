import type { Thumb } from "../lib/thumbnail";

export interface ExampleMetadata {
  title: string;
  description?: string;
  thumb: Thumb;
}

// Replaced from public JSON files by exampleMetadataPlugin in dev, tests and builds.
export const exampleMetadata: Record<string, ExampleMetadata> = {};
