/**
 * Every tutorial's id, without its words: the generated e2e (tests/e2e/tutorials.spec.ts) lists one test per id at
 * collection time, in Node. The catalog test keeps this in step with ./index.ts.
 */
export const tutorialIds = [
  "mobile-api",
  "quick-add",
  "dots-and-sides",
  "insert-on-edge",
  "property-sheet",
  "request-vs-message",
  "boundaries",
  "annotate",
  "dependencies",
  "arrange",
  "command-palette",
  "share-present",
] as const;
