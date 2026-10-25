/**
 * Every tutorial's id, without its words: the generated e2e (tests/e2e/tutorials.spec.ts) lists one test per id at
 * collection time, in Node. The catalog test keeps this in step with ./index.ts.
 */
import type { TutorialMetadata } from "../types";

export const tutorialEntries: readonly Pick<TutorialMetadata, "id" | "quarantined">[] = [
  { id: "mobile-api" },
  { id: "quick-add" },
  { id: "dots-and-sides" },
  { id: "insert-on-edge", quarantined: true },
  { id: "property-sheet" },
  { id: "request-vs-message" },
  { id: "boundaries" },
  { id: "annotate" },
  { id: "dependencies" },
  { id: "arrange", quarantined: true },
  { id: "command-palette" },
  { id: "share-present" },
  { id: "api-gateway" },
  { id: "kafka-topic" },
  { id: "queue-workers" },
  { id: "load-balancer" },
  { id: "cache-aside" },
  { id: "webhooks" },
  { id: "fanout" },
  { id: "partitions" },
  { id: "outbox" },
  { id: "dependencies-2", quarantined: true },
  { id: "rates-and-inputs" },
  { id: "read-a-node" },
  { id: "capacity", quarantined: true },
  { id: "trace-slowmo", quarantined: true },
  { id: "saved-simulations", quarantined: true },
  { id: "faults" },
  { id: "author-a-drill" },
  { id: "retry-storm" },
  { id: "backoff-budget" },
  { id: "circuit-breaker" },
  { id: "rate-limit", quarantined: true },
];
