import type { DiagramFile } from "../model/types";
import kafkaOrderPipeline from "./kafka-order-pipeline.json";
import azureServiceBusIntegration from "./azure-service-bus-integration.json";
import cdcAnalytics from "./cdc-analytics.json";
import awsFanout from "./aws-fanout.json";
import iotTelemetry from "./iot-telemetry.json";
import aksAppConfigKeyVault from "./aks-app-config-key-vault.json";
import eventDrivenDataPlatform from "./event-driven-data-platform.json";
import outboxSagaCheckout from "./outbox-saga-checkout.json";
import cqrsEventSourcing from "./cqrs-event-sourcing.json";
import awsServerlessOrders from "./aws-serverless-orders.json";
import gcpStreamingAnalytics from "./gcp-streaming-analytics.json";
import ragAssistant from "./rag-assistant.json";
import webhookIngestion from "./webhook-ingestion.json";
import notificationFanout from "./notification-fanout.json";
import multiRegionActiveActive from "./multi-region-active-active.json";
import nightlyBatchElt from "./nightly-batch-elt.json";

/** The themes the example picker and the start card group examples by, in display order. */
export const EXAMPLE_THEMES = [
  { id: "streaming", label: "Event streaming" },
  { id: "data", label: "Data & AI" },
  { id: "cloud", label: "Cloud apps" },
  { id: "integration", label: "Integration" },
  { id: "reliability", label: "Reliability" },
] as const;

export type ExampleTheme = (typeof EXAMPLE_THEMES)[number]["id"];

export interface Example {
  slug: string;
  diagram: DiagramFile;
  /** Local-only examples are never eligible for AI tools or prompts. */
  localOnly?: boolean;
  /** Picker and start-card group. Local-only diagrams have none. */
  theme?: ExampleTheme;
  /** One short line for the start card (the diagram's description is longer). */
  summary?: string;
  /** Shown on the start card before "All examples". */
  featured?: boolean;
}

// Work diagrams live in ./private (gitignored) and only load in dev, so they never ship in the public build.
const privateExamples: Example[] = import.meta.env.DEV
  ? Object.entries(import.meta.glob<DiagramFile>("./private/*.json", { eager: true, import: "default" })).map(
      ([path, diagram]) => ({ slug: path.slice("./private/".length, -".json".length), diagram, localOnly: true }),
    )
  : [];

const d = (diagram: unknown) => diagram as DiagramFile;

/** Public examples, grouped by theme in the picker; within a theme, in this order. */
export const examples: Example[] = [
  ...privateExamples,
  {
    slug: "kafka-order-pipeline",
    diagram: d(kafkaOrderPipeline),
    theme: "streaming",
    summary: "Consumer groups, local stores, payment events",
    featured: true,
  },
  {
    slug: "cqrs-event-sourcing",
    diagram: d(cqrsEventSourcing),
    theme: "streaming",
    summary: "Event store, projections, rebuildable read models",
  },
  {
    slug: "cdc-analytics",
    diagram: d(cdcAnalytics),
    theme: "streaming",
    summary: "Debezium CDC into search, a warehouse and a lake",
  },
  {
    slug: "iot-telemetry",
    diagram: d(iotTelemetry),
    theme: "streaming",
    summary: "Partitioned telemetry, hot state, threshold alerts",
  },
  {
    slug: "event-driven-data-platform",
    diagram: d(eventDrivenDataPlatform),
    theme: "data",
    summary: "Kafka into Snowflake, dbt, reverse ETL back out",
    featured: true,
  },
  {
    slug: "nightly-batch-elt",
    diagram: d(nightlyBatchElt),
    theme: "data",
    summary: "Airflow, Airbyte and dbt on a nightly schedule",
  },
  {
    slug: "gcp-streaming-analytics",
    diagram: d(gcpStreamingAnalytics),
    theme: "data",
    summary: "Pub/Sub, Dataflow and BigQuery for Looker",
  },
  {
    slug: "rag-assistant",
    diagram: d(ragAssistant),
    theme: "data",
    summary: "Embeddings, vector search, an LLM and evals",
    featured: true,
  },
  {
    slug: "aws-serverless-orders",
    diagram: d(awsServerlessOrders),
    theme: "cloud",
    summary: "Lambda, DynamoDB Streams, EventBridge rules",
    featured: true,
  },
  {
    slug: "aws-fanout",
    diagram: d(awsFanout),
    theme: "cloud",
    summary: "SNS to isolated SQS queues and Lambda workers",
  },
  {
    slug: "aks-app-config-key-vault",
    diagram: d(aksAppConfigKeyVault),
    theme: "cloud",
    summary: "Settings, Key Vault references and identity",
  },
  {
    slug: "webhook-ingestion",
    diagram: d(webhookIngestion),
    theme: "integration",
    summary: "Fast acks, a buffer, retries, a DLQ and replay",
  },
  {
    slug: "notification-fanout",
    diagram: d(notificationFanout),
    theme: "integration",
    summary: "Email, SMS and push by preference, rate limited",
  },
  {
    slug: "azure-service-bus-integration",
    diagram: d(azureServiceBusIntegration),
    theme: "integration",
    summary: "Filtered subscriptions, commands, dead lettering",
  },
  {
    slug: "outbox-saga-checkout",
    diagram: d(outboxSagaCheckout),
    theme: "reliability",
    summary: "Transactional outbox, saga steps, compensation",
  },
  {
    slug: "multi-region-active-active",
    diagram: d(multiRegionActiveActive),
    theme: "reliability",
    summary: "Two live regions, failover, a global table",
  },
];

export function themeLabel(theme: ExampleTheme): string {
  return EXAMPLE_THEMES.find((t) => t.id === theme)?.label ?? theme;
}
