import type { DiagramFile } from "../model/types";
import { diagramThumb } from "../lib/thumbnail";
import type { ExampleTheme } from "./themes";
import { exampleMetadata, type ExampleMetadata } from "./metadata";

interface ExampleInfo extends ExampleMetadata {
  slug: string;
  /** Picker and start-card group. Local-only diagrams have none. */
  theme?: ExampleTheme;
  /** One short line for the start card (the diagram's description is longer). */
  summary?: string;
  /** Shown on the start card before "All examples". */
  featured?: boolean;
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
      slug: "kafka-order-pipeline",
      theme: "streaming",
      summary: "Consumer groups, local stores, payment events",
      featured: true,
    },
    {
      slug: "keda-render-workers",
      theme: "streaming",
      summary: "Kafka lag wakes workers from zero; idle workers sleep",
    },
    {
      slug: "autoscaling-image-workers",
      theme: "streaming",
      summary: "HPA startup, buffered uploads and replica history",
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
      slug: "iot-telemetry",
      theme: "streaming",
      summary: "Partitioned telemetry, hot state, threshold alerts",
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
      slug: "aws-serverless-orders",
      theme: "cloud",
      summary: "Lambda, DynamoDB Streams, EventBridge rules",
      featured: true,
    },
    {
      slug: "aws-fanout",
      theme: "cloud",
      summary: "SNS to isolated SQS queues and Lambda workers",
    },
    {
      slug: "aks-app-config-key-vault",
      theme: "cloud",
      summary: "Settings, Key Vault references and identity",
    },
    {
      slug: "webhook-ingestion",
      theme: "integration",
      summary: "Fast acks, a buffer, retries, a DLQ and replay",
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
      slug: "multi-region-active-active",
      theme: "reliability",
      summary: "Two live regions, failover, a global table",
    },
    {
      slug: "branch-to-datacentre",
      theme: "reliability",
      summary: "Routers, a firewall pair, spine and leaf, an ADC",
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
      slug: "shared-api-quotas",
      theme: "data",
      summary: "Shared model tokens and payment rate limits",
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
).map((example) => ({ ...example, ...exampleMetadata[example.slug] }));

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
