import type { Stencil } from "../model/types";

/**
 * Vendor families: the small, stable set of filters shown above the stencil list instead of one
 * chip per vendor. Every catalog vendor maps to exactly one family (a unit test keeps it honest);
 * a vendor added later without a mapping lands in "other", which only shows when it has stencils.
 */
export type FamilyId = "azure" | "aws" | "gcp" | "streaming" | "oss" | "saas" | "generic" | "other";

export interface Family {
  id: FamilyId;
  label: string;
  /** Short label for tight spaces (the canvas palette). */
  short: string;
  /** Identifying dot colour. */
  hue: string;
  hint: string;
}

export const FAMILIES: readonly Family[] = [
  { id: "azure", label: "Azure", short: "Azure", hue: "#0078D4", hint: "Azure services and Microsoft products" },
  { id: "aws", label: "AWS", short: "AWS", hue: "#FF9900", hint: "Amazon Web Services" },
  { id: "gcp", label: "Google Cloud", short: "GCP", hue: "#4285F4", hint: "Google Cloud services" },
  {
    id: "streaming",
    label: "Kafka & streaming",
    short: "Streaming",
    hue: "#7C3AED",
    hint: "Kafka, Pulsar, RabbitMQ, NATS, CDC and stream processors",
  },
  {
    id: "oss",
    label: "Open source",
    short: "Open source",
    hue: "#10B981",
    hint: "Databases, runtimes, orchestration and tooling you can self-host",
  },
  {
    id: "saas",
    label: "SaaS",
    short: "SaaS",
    hue: "#E5484D",
    hint: "Hosted platforms: data, observability, identity, payments, messaging and AI APIs",
  },
  {
    id: "generic",
    label: "Generic & clients",
    short: "Generic",
    hue: "#64748B",
    hint: "Vendor-neutral shapes, people, devices and partners",
  },
  { id: "other", label: "Other", short: "Other", hue: "#8A94A6", hint: "Vendors without a family yet" },
];

const VENDOR_FAMILY: Record<string, FamilyId> = {
  Azure: "azure",
  Microsoft: "azure",
  AWS: "aws",
  "Google Cloud": "gcp",
  "Apache Kafka": "streaming",
  RabbitMQ: "streaming",
  NATS: "streaming",
  Confluent: "streaming",
  "Apache Pulsar": "streaming",
  MQTT: "streaming",
  "Apache Flink": "streaming",
  Debezium: "streaming",
  PostgreSQL: "oss",
  MySQL: "oss",
  Redis: "oss",
  MongoDB: "oss",
  Elastic: "oss",
  Kubernetes: "oss",
  Docker: "oss",
  NGINX: "oss",
  Kong: "oss",
  "Grafana Labs": "oss",
  Prometheus: "oss",
  OpenTelemetry: "oss",
  HashiCorp: "oss",
  ".NET": "oss",
  Java: "oss",
  "Node.js": "oss",
  Python: "oss",
  Go: "oss",
  "Apache Cassandra": "oss",
  ClickHouse: "oss",
  MinIO: "oss",
  Temporal: "oss",
  Camunda: "oss",
  "Apache Airflow": "oss",
  Envoy: "oss",
  Istio: "oss",
  Linkerd: "oss",
  Traefik: "oss",
  HAProxy: "oss",
  Jaeger: "oss",
  Keycloak: "oss",
  Argo: "oss",
  GraphQL: "oss",
  gRPC: "oss",
  Snowflake: "saas",
  Databricks: "saas",
  Datadog: "saas",
  Splunk: "saas",
  Cloudflare: "saas",
  Adobe: "saas",
  GitHub: "saas",
  Vercel: "saas",
  Netlify: "saas",
  Supabase: "saas",
  Pinecone: "saas",
  "New Relic": "saas",
  Sentry: "saas",
  Okta: "saas",
  Stripe: "saas",
  Twilio: "saas",
  Salesforce: "saas",
  HubSpot: "saas",
  Slack: "saas",
  OpenAI: "saas",
  Anthropic: "saas",
  "dbt Labs": "oss",
  Airbyte: "oss",
  Tableau: "saas",
  Generic: "generic",
  Client: "generic",
};

export function familyOfVendor(vendor: string): FamilyId {
  return VENDOR_FAMILY[vendor] ?? "other";
}

export function familyOf(s: Pick<Stencil, "vendor">): FamilyId {
  return familyOfVendor(s.vendor);
}

export function getFamily(id: FamilyId): Family {
  return FAMILIES.find((f) => f.id === id) ?? FAMILIES[FAMILIES.length - 1];
}

export function isFamilyId(v: unknown): v is FamilyId {
  return typeof v === "string" && FAMILIES.some((f) => f.id === v);
}

/** Families with their stencil counts, in display order. Empty families are dropped (so "other" usually is). */
export function familyCounts(list: readonly Stencil[]): { family: Family; count: number }[] {
  const counts = new Map<FamilyId, number>();
  for (const s of list) counts.set(familyOf(s), (counts.get(familyOf(s)) ?? 0) + 1);
  return FAMILIES.filter((f) => counts.has(f.id)).map((family) => ({ family, count: counts.get(family.id)! }));
}

/** Vendors grouped by family (most stencils first), for the vendor overflow menu. */
export function vendorsByFamily(
  list: readonly Stencil[],
): { family: Family; vendors: { vendor: string; count: number }[] }[] {
  const byVendor = new Map<string, number>();
  for (const s of list) byVendor.set(s.vendor, (byVendor.get(s.vendor) ?? 0) + 1);
  return FAMILIES.map((family) => ({
    family,
    vendors: [...byVendor]
      .filter(([v]) => familyOfVendor(v) === family.id)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([vendor, count]) => ({ vendor, count })),
  })).filter((g) => g.vendors.length > 0);
}
