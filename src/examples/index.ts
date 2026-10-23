import type { DiagramFile } from "../model/types";
import { diagramThumb } from "../lib/thumbnail";
import type { ExampleTheme } from "./themes";
import { exampleMetadata, type ExampleMetadata } from "./metadata";
import { msg } from "../i18n";

interface ExampleInfo extends ExampleMetadata {
  slug: string;
  /** Picker and start-card group. Local-only diagrams have none. */
  theme?: ExampleTheme;
  /** One short line for the start card (the diagram's description is longer). */
  summary?: string | (() => string);
  /** Shown on the start card before "All examples". */
  featured?: boolean;
  /** Configured mechanisms that this lesson does not teach. */
  omitShows?: readonly string[];
}

interface PublicExample extends ExampleInfo {
  localOnly?: false;
  diagram?: never;
}

interface LocalExample extends ExampleInfo {
  /** Local-only examples are never eligible for AI tools or prompts. */
  localOnly: true;
  /** Retained eagerly in dev so privacy fingerprints work before opening an example. */
  diagram: DiagramFile;
}

export type Example = PublicExample | LocalExample;

export const exampleSummary = (example: Example) =>
  (typeof example.summary === "function" ? example.summary() : example.summary) ?? example.description;

// Work diagrams stay dev-only and eager so privacy checks work even before they are opened.
const privateExamples: LocalExample[] = import.meta.env.DEV
  ? Object.entries(import.meta.glob<DiagramFile>("./private/*.json", { eager: true, import: "default" })).map(
      ([path, diagram]) => ({
        slug: path.slice("./private/".length, -".json".length),
        title: diagram.title,
        thumb: diagramThumb(diagram),
        description: diagram.description,
        simulation: diagram.simulations?.[0]?.id,
        diagram,
        localOnly: true,
      }),
    )
  : [];

/** Public examples. The picker and start card group them by theme (see ./themes); within a theme, in this order. */
const publicExamples: PublicExample[] = (
  [
    {
      slug: "black-friday-commerce",
      theme: "systems",
      summary: "60 services: route table, HPA, KEDA, outbox, DLQ",
      featured: true,
    },
    {
      slug: "cell-based-bookings",
      theme: "systems",
      summary: "Three regions, six cells, global tables, failover",
    },
    {
      slug: "payments-ledger",
      theme: "systems",
      summary: "PSP router, PCI zone, outbox, ledger, webhooks",
    },
    {
      slug: "delivery-dispatch",
      theme: "systems",
      summary: "Courier pings, H3 partitions, KEDA, maps quota",
    },
    {
      slug: "ev-charging-network",
      theme: "systems",
      summary: "Depot firewalls, Event Hubs, twins, firmware waves",
    },
    {
      slug: "recommendations-feature-store",
      theme: "systems",
      summary: "Feature store, canary and shadow rankers, KEDA scorer",
    },
    {
      slug: "video-on-demand-pipeline",
      theme: "systems",
      summary: "Encode ladders on KEDA, DRM, CDN, encode latency",
    },
    {
      slug: "observability-pipeline",
      theme: "systems",
      summary: "OTel gateways, Kafka buffer, Loki outage drill",
    },
    {
      slug: "hybrid-enterprise-network",
      theme: "systems",
      summary: "HQ, SD-WAN branches, spine and leaf, a fibre-cut drill",
    },
    {
      slug: "blocking-call",
      omitShows: ["partitions"],
      theme: "reliability",
      summary: msg("examples.blockingSummary"),
    },
    {
      slug: "retry-storm",
      theme: "reliability",
      summary: msg("examples.retryStormSummary"),
    },
    {
      slug: "slow-payment-provider",
      omitShows: ["routing"],
      theme: "reliability",
      summary: msg("examples.paymentTimeoutSummary"),
    },
    {
      slug: "scale-on-busy-threads",
      omitShows: ["partitions"],
      theme: "reliability",
      summary: msg("examples.busySummary"),
    },
    {
      slug: "where-the-time-goes",
      theme: "streaming",
      summary: msg("examples.latencySummary"),
    },
    {
      slug: "kafka-order-pipeline",
      theme: "streaming",
      summary: "Consumer groups, local stores, payment events",
      featured: true,
    },
    {
      slug: "autoscaling-basics",
      theme: "streaming",
      summary: "HPA on CPU and KEDA from zero, side by side",
    },
    {
      slug: "cqrs-event-sourcing",
      theme: "streaming",
      summary: "Event store, projections, rebuildable read models",
    },
    {
      slug: "cdc-analytics",
      theme: "streaming",
      summary: "Debezium CDC into search, a warehouse and a lake",
    },
    {
      slug: "partitions-vs-subscriptions",
      theme: "streaming",
      summary: "Three partitions, eight readers, independent subscriptions",
    },
    {
      slug: "shared-worker-pool",
      theme: "streaming",
      summary: "Two inputs share four worker slots",
    },
    {
      slug: "event-driven-data-platform",
      theme: "data",
      summary: "Kafka into Snowflake, dbt, reverse ETL back out",
      featured: true,
    },
    {
      slug: "nightly-batch-elt",
      theme: "data",
      summary: "Airflow, Airbyte and dbt on a nightly schedule",
    },
    {
      slug: "gcp-streaming-analytics",
      theme: "data",
      summary: "Pub/Sub, Dataflow and BigQuery for Looker",
    },
    {
      slug: "rag-assistant",
      theme: "data",
      summary: "Embeddings, vector search, an LLM and evals",
      featured: true,
    },
    {
      slug: "shared-api-quotas",
      theme: "data",
      summary: "Shared model tokens and payment rate limits",
    },
    {
      slug: "vendor-edge-storefront",
      theme: "cloud",
      summary: "Fastly, Cloudflare WAF, R2, Cognito and Square",
    },
    {
      slug: "aws-serverless-orders",
      theme: "cloud",
      summary: "Lambda, DynamoDB Streams, EventBridge fan-out",
    },
    {
      slug: "aks-app-config-key-vault",
      theme: "cloud",
      summary: "Settings, Key Vault references and identity",
    },
    {
      slug: "serverless-burst-buffer",
      theme: "cloud",
      summary: "Reserved concurrency rejects; a queue buffers",
    },
    {
      slug: "cloud-run-timetable-api",
      theme: "cloud",
      summary: "Cloud Run sleeps overnight; sizing suggests a max",
    },
    {
      slug: "webhook-ingestion",
      theme: "integration",
      summary: "Fast acks, a buffer, retries, a DLQ and replay",
    },
    {
      slug: "api-route-table",
      theme: "integration",
      summary: "A gateway route table, a canary split and a 404",
    },
    {
      slug: "notification-fanout",
      theme: "integration",
      summary: "Email, SMS and push by preference, rate limited",
    },
    {
      slug: "azure-service-bus-integration",
      theme: "integration",
      summary: "Filtered subscriptions, commands, dead lettering",
    },
    {
      slug: "outbox-saga-checkout",
      theme: "reliability",
      summary: "Transactional outbox, saga steps, compensation",
    },
    {
      slug: "zone-outage-drill",
      theme: "reliability",
      summary: "A zone outage, health checks and a drill without them",
    },
    {
      slug: "branch-to-datacentre",
      theme: "reliability",
      summary: "Routers, a firewall pair, spine and leaf, an ADC",
    },
    {
      slug: "measured-order-capacity",
      theme: "reliability",
      summary: "Pinned defaults versus measured payment capacity",
    },
    {
      slug: "contoso-dmz",
      theme: "reliability",
      summary: "A compact DMZ with allowed web and blocked probes",
    },
  ] as const
).map((example) => {
  const info: ExampleInfo = { ...example, ...exampleMetadata[example.slug] };
  return { ...info, shows: info.shows?.filter((tag) => !info.omitShows?.includes(tag)) };
});

export const examples: Example[] = [...privateExamples, ...publicExamples];

// The glob is deliberately shallow: public chunks never include local-only diagrams.
const loaders = import.meta.glob<DiagramFile>("./*.json", { import: "default" });
const loaded = new Map<string, DiagramFile>();
const pending = new Map<string, Promise<DiagramFile>>();

/** Synchronous reads are for already opened examples and dev privacy checks only. */
export function getLoadedExample(slug: string): DiagramFile | undefined {
  return loaded.get(slug) ?? privateExamples.find((e) => e.slug === slug)?.diagram;
}

/** Share in-flight imports; cache successful loads and let failed loads be retried. */
export function loadExample(slug: string): Promise<DiagramFile> {
  const diagram = getLoadedExample(slug);
  if (diagram) return Promise.resolve(diagram);
  const existing = pending.get(slug);
  if (existing) return existing;
  const load = loaders[`./${slug}.json`];
  if (!load || !publicExamples.some((e) => e.slug === slug))
    return Promise.reject(new Error("That example is unavailable."));
  const promise = load()
    .then((d) => {
      loaded.set(slug, d);
      return d;
    })
    .finally(() => pending.delete(slug));
  pending.set(slug, promise);
  return promise;
}
