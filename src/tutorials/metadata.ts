import { msg } from "../i18n";
import { tutorialEntries } from "./catalog/ids";
import type { TutorialMetadata } from "./types";

/** Titles only. Entry points must never import the catalog's steps into startup or canvas. */
export const tutorialMetadata: readonly TutorialMetadata[] =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
    ? (
        [
          { id: "mobile-api", title: msg("tutorials.mobileApi.title") },
          { id: "quick-add", title: msg("tutorials.quickAdd.title") },
          { id: "dots-and-sides", title: msg("tutorials.dotsAndSides.title") },
          { id: "insert-on-edge", title: msg("tutorials.insertOnEdge.title") },
          { id: "property-sheet", title: msg("tutorials.propertySheet.title") },
          { id: "request-vs-message", title: msg("tutorials.requestVsMessage.title") },
          { id: "boundaries", title: msg("tutorials.boundaries.title") },
          { id: "annotate", title: msg("tutorials.annotate.title") },
          { id: "dependencies", title: msg("tutorials.dependencies.title") },
          { id: "arrange", title: msg("tutorials.arrange.title") },
          { id: "command-palette", title: msg("tutorials.commandPalette.title") },
          { id: "share-present", title: msg("tutorials.sharePresent.title") },
          { id: "api-gateway", title: msg("tutorials.apiGateway.title") },
          { id: "kafka-topic", title: msg("tutorials.kafkaTopic.title") },
          { id: "queue-workers", title: msg("tutorials.queueWorkers.title") },
          { id: "load-balancer", title: msg("tutorials.loadBalancer.title") },
          { id: "cache-aside", title: msg("tutorials.cacheAside.title") },
          { id: "webhooks", title: msg("tutorials.webhooks.title") },
          { id: "fanout", title: msg("tutorials.fanout.title") },
          { id: "partitions", title: msg("tutorials.partitions.title") },
          { id: "outbox", title: msg("tutorials.outbox.title") },
          { id: "dependencies-2", title: msg("tutorials.dependencies2.title") },
          { id: "where-time-goes", title: msg("tutorials.whereTimeGoes.title") },
          { id: "threads-block", title: msg("tutorials.threadsBlock.title") },
          { id: "timeouts-pools", title: msg("tutorials.timeoutsPools.title") },
          { id: "backlog-lag", title: msg("tutorials.backlogLag.title") },
          { id: "autoscaling", title: msg("tutorials.autoscaling.title") },
          { id: "scale-to-zero", title: msg("tutorials.scaleToZero.title") },
          { id: "rates-and-inputs", title: msg("tutorials.ratesAndInputs.title") },
          { id: "read-a-node", title: msg("tutorials.readANode.title") },
          { id: "capacity", title: msg("tutorials.capacity.title") },
          { id: "trace-slowmo", title: msg("tutorials.traceSlowmo.title") },
          { id: "saved-simulations", title: msg("tutorials.savedSimulations.title") },
          { id: "faults", title: msg("tutorials.faults.title") },
          { id: "author-a-drill", title: msg("tutorials.authorADrill.title") },
          { id: "retry-storm", title: msg("tutorials.retryStorm.title") },
          { id: "backoff-budget", title: msg("tutorials.backoffBudget.title") },
          { id: "circuit-breaker", title: msg("tutorials.circuitBreaker.title") },
          { id: "rate-limit", title: msg("tutorials.rateLimit.title") },
        ] as const
      ).filter((t) => !tutorialEntries.find((entry) => entry.id === t.id)?.quarantined)
    : [];
