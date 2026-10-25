import { msg } from "../i18n";

/** Titles only. Entry points must never import the catalog's steps into startup or canvas. */
export const tutorialMetadata =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
    ? ([
        { id: "mobile-api", title: msg("tutorials.mobileApi.title") },
        { id: "api-gateway", title: msg("tutorials.apiGateway.title") },
        { id: "kafka-topic", title: msg("tutorials.kafkaTopic.title") },
        { id: "queue-workers", title: msg("tutorials.queueWorkers.title") },
        { id: "load-balancer", title: msg("tutorials.loadBalancer.title") },
        { id: "cache-aside", title: msg("tutorials.cacheAside.title") },
      ] as const)
    : [];
