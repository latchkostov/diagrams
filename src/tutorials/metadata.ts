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
        ] as const
      ).filter((t) => !tutorialEntries.find((entry) => entry.id === t.id)?.quarantined)
    : [];
