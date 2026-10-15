import { BROKERS, type BrokerSpec } from "../model/brokers";
import type { SimRole } from "../model/types";
import type { NodeSimProps } from "../sim/types";
import { PROCESSOR_VALUES, deviceValues } from "../model/planningPresets";
import { ADMISSION_PRESETS, ADMISSION_REVISION, admissionPresetFor } from "../model/admissionPresets";

/** Behavioural families; no role inference for unknown stencil ids. P1 retains legacy dispatch. */
export type FamilyId =
  | "log"
  | "queue"
  | "pubsub"
  | "service"
  | "serverless"
  | "workflow"
  | "stream-processor"
  | "sql"
  | "nosql"
  | "cache"
  | "search"
  | "object"
  | "warehouse"
  | "api-gateway"
  | "proxy"
  | "edge"
  | "dns"
  | "mesh"
  | "device"
  | "external-api"
  | "model-api"
  | "client"
  | "scheduler"
  | "telemetry"
  | "dependency";
export type EvidenceClass = "default" | "quota" | "benchmark" | "assumption" | "unverified";
export interface SettingSpec {
  key: keyof NodeSimProps;
  unit?: "msg/s" | "ms" | "slots/replica" | "replicas" | "%" | "connections" | "queries" | "Gbps" | "kB";
  tier: "main" | "advanced";
}
export interface Preset {
  id: string;
  revision: string;
  values: Partial<NodeSimProps>;
  sources: {
    key: keyof NodeSimProps;
    evidence: EvidenceClass;
    unit: SettingSpec["unit"];
    note: string;
    url?: string;
    checked?: string;
  }[];
}
export interface StencilProfile {
  family: FamilyId;
  broker?: BrokerSpec;
}
export interface FamilySpec {
  roles: SimRole[];
  defaults: Partial<NodeSimProps>;
  settings: SettingSpec[];
  overLimit: "wait" | "reject" | "unknown" | "none";
}
export interface ResolutionEvidence {
  family?: FamilyId;
  revision: "legacy" | "p1" | "p2" | "p3" | "p3-a1";
  preset?: string;
  presetRevision?: string;
  evidence: Preset["sources"];
  units: "real";
}

/** Explicit catalogue coverage, maintained rather than guessed from a vendor name or dispatch role. */
export const PROFILES: Readonly<Record<string, StencilProfile>> = {
  "kafka.topic": { family: "log" },
  "kafka.cluster": { family: "dependency" },
  "kafka.connect": { family: "stream-processor" },
  "kafka.schema-registry": { family: "dependency" },
  "kafka.ksqldb": { family: "stream-processor" },
  "azure.service-bus.queue": { family: "queue" },
  "azure.service-bus.topic": { family: "pubsub" },
  "azure.event-hubs": { family: "log" },
  "azure.event-grid": { family: "pubsub" },
  "azure.storage-queue": { family: "queue" },
  "rabbitmq.exchange": { family: "pubsub" },
  "rabbitmq.queue": { family: "queue" },
  "aws.sqs": { family: "queue" },
  "aws.sns": { family: "pubsub" },
  "aws.eventbridge": { family: "pubsub" },
  "aws.kinesis": { family: "log" },
  "gcp.pubsub": { family: "pubsub" },
  "nats.subject": { family: "pubsub" },
  "redis.stream": { family: "log" },
  "confluent.cloud": { family: "log" },
  "kafka.streams": { family: "stream-processor" },
  debezium: { family: "client" },
  "pulsar.topic": { family: "log" },
  "mqtt.broker": { family: "pubsub" },
  "aws.msk": { family: "log" },
  "aws.mq": { family: "queue" },
  "azure.functions": { family: "serverless" },
  "azure.app-service": { family: "service" },
  "azure.container-apps": { family: "service" },
  "azure.aks": { family: "dependency" },
  "azure.logic-apps": { family: "workflow" },
  "azure.signalr": { family: "proxy" },
  "aws.lambda": { family: "serverless" },
  "aws.ecs": { family: "service" },
  "aws.step-functions": { family: "workflow" },
  "k8s.pod": { family: "service" },
  "k8s.deployment": { family: "dependency" },
  "docker.container": { family: "service" },
  "service.dotnet": { family: "service" },
  "service.java": { family: "service" },
  "service.node": { family: "service" },
  "service.python": { family: "service" },
  "service.go": { family: "service" },
  flink: { family: "stream-processor" },
  "gcp.dataflow": { family: "stream-processor" },
  temporal: { family: "workflow" },
  camunda: { family: "workflow" },
  airflow: { family: "scheduler" },
  "gcp.cloud-run": { family: "service" },
  "gcp.cloud-functions": { family: "serverless" },
  "gcp.gke": { family: "dependency" },
  "azure.static-web-apps": { family: "service" },
  vercel: { family: "service" },
  netlify: { family: "service" },
  "cloudflare.workers": { family: "serverless" },
  graphql: { family: "api-gateway" },
  grpc: { family: "service" },
  postgres: { family: "sql" },
  mysql: { family: "sql" },
  sqlserver: { family: "sql" },
  "azure.sql": { family: "sql" },
  "azure.cosmos-db": { family: "nosql" },
  "azure.blob-storage": { family: "object" },
  "azure.redis": { family: "cache" },
  mongodb: { family: "nosql" },
  "redis.cache": { family: "cache" },
  elasticsearch: { family: "search" },
  "aws.s3": { family: "object" },
  "aws.dynamodb": { family: "nosql" },
  snowflake: { family: "warehouse" },
  "adobe.aem": { family: "object" },
  databricks: { family: "warehouse" },
  "gcp.bigquery": { family: "warehouse" },
  "gcp.spanner": { family: "sql" },
  "gcp.cloud-sql": { family: "sql" },
  "gcp.firestore": { family: "nosql" },
  "aws.redshift": { family: "warehouse" },
  "aws.aurora": { family: "sql" },
  cassandra: { family: "nosql" },
  clickhouse: { family: "warehouse" },
  supabase: { family: "sql" },
  firebase: { family: "nosql" },
  minio: { family: "object" },
  pinecone: { family: "search" },
  "azure.data-factory": { family: "stream-processor" },
  "azure.synapse": { family: "warehouse" },
  "microsoft-fabric": { family: "warehouse" },
  "azure.api-management": { family: "api-gateway" },
  "azure.front-door": { family: "edge" },
  "azure.app-gateway": { family: "proxy" },
  "aws.api-gateway": { family: "api-gateway" },
  "aws.elb": { family: "proxy" },
  nginx: { family: "proxy" },
  kong: { family: "api-gateway" },
  cloudflare: { family: "edge" },
  "load-balancer": { family: "proxy" },
  envoy: { family: "proxy" },
  istio: { family: "mesh" },
  linkerd: { family: "mesh" },
  traefik: { family: "proxy" },
  haproxy: { family: "proxy" },
  "generic.cdn": { family: "edge" },
  "generic.dns": { family: "dns" },
  "generic.firewall": { family: "device" },
  "generic.router": { family: "device" },
  "cisco.isr": { family: "device" },
  "juniper.mx": { family: "device" },
  "generic.switch": { family: "device" },
  "cisco.catalyst": { family: "device" },
  "cisco.nexus": { family: "device" },
  "arista.switch": { family: "device" },
  "juniper.ex": { family: "device" },
  "juniper.qfx": { family: "device" },
  "aruba.cx": { family: "device" },
  "generic.ngfw": { family: "device" },
  "paloalto.ngfw": { family: "device" },
  "fortinet.fortigate": { family: "device" },
  "cisco.secure-firewall": { family: "device" },
  "checkpoint.quantum": { family: "device" },
  "juniper.srx": { family: "device" },
  "generic.adc": { family: "device" },
  "f5.bigip": { family: "device" },
  "netscaler.adc": { family: "device" },
  grafana: { family: "telemetry" },
  prometheus: { family: "telemetry" },
  datadog: { family: "telemetry" },
  "azure.app-insights": { family: "telemetry" },
  opentelemetry: { family: "service" },
  splunk: { family: "telemetry" },
  loki: { family: "telemetry" },
  jaeger: { family: "telemetry" },
  kibana: { family: "telemetry" },
  "new-relic": { family: "telemetry" },
  sentry: { family: "telemetry" },
  "aws.cloudwatch": { family: "telemetry" },
  "azure.key-vault": { family: "dependency" },
  "entra-id": { family: "dependency" },
  vault: { family: "dependency" },
  okta: { family: "dependency" },
  auth0: { family: "dependency" },
  keycloak: { family: "dependency" },
  "azure.app-config": { family: "dependency" },
  "azure.managed-identity": { family: "dependency" },
  "aws.secrets-manager": { family: "dependency" },
  "aws.parameter-store": { family: "dependency" },
  "aws.iam-role": { family: "dependency" },
  "gcp.service-account": { family: "dependency" },
  "gcp.secret-manager": { family: "dependency" },
  "k8s.configmap": { family: "dependency" },
  "k8s.secret": { family: "dependency" },
  "client.user": { family: "client" },
  "client.browser": { family: "client" },
  "client.mobile": { family: "client" },
  "client.partner": { family: "external-api" },
  "client.iot": { family: "client" },
  "client.team": { family: "client" },
  stripe: { family: "external-api" },
  iterable: { family: "external-api" },
  braze: { family: "external-api" },
  segment: { family: "external-api" },
  shopify: { family: "external-api" },
  paypal: { family: "external-api" },
  adyen: { family: "external-api" },
  twilio: { family: "external-api" },
  sendgrid: { family: "external-api" },
  salesforce: { family: "external-api" },
  hubspot: { family: "external-api" },
  slack: { family: "external-api" },
  github: { family: "client" },
  openai: { family: "model-api" },
  "anthropic.claude": { family: "model-api" },
  "generic.service": { family: "service" },
  "generic.database": { family: "sql" },
  "generic.queue": { family: "queue" },
  "generic.topic": { family: "pubsub" },
  "generic.scheduler": { family: "scheduler" },
  "generic.webhook": { family: "client" },
  "generic.email": { family: "external-api" },
  "github-actions": { family: "scheduler" },
  "generic.batch-job": { family: "service" },
  "generic.push": { family: "external-api" },
  "generic.sms": { family: "external-api" },
  "generic.file": { family: "object" },
  "generic.warehouse": { family: "warehouse" },
  "generic.cache": { family: "cache" },
  "generic.search-index": { family: "search" },
  "generic.vector-db": { family: "search" },
  "generic.ml-model": { family: "model-api" },
  "generic.llm": { family: "model-api" },
  "generic.external-api": { family: "external-api" },
  terraform: { family: "dependency" },
  argocd: { family: "dependency" },
  "generic.config-store": { family: "dependency" },
  "generic.secret-store": { family: "dependency" },
  "generic.identity-provider": { family: "dependency" },
  dbt: { family: "stream-processor" },
  airbyte: { family: "stream-processor" },
  "snowflake.snowpipe": { family: "stream-processor" },
  "generic.reverse-etl": { family: "stream-processor" },
  "gcp.cloud-storage": { family: "object" },
  looker: { family: "telemetry" },
  tableau: { family: "telemetry" },
  "aws.route53": { family: "dns" },
  "azure.traffic-manager": { family: "dns" },
  "gcp.cloud-load-balancing": { family: "proxy" },
  "generic.event-store": { family: "log" },
  "generic.projection": { family: "service" },
  "generic.saga": { family: "workflow" },
  "generic.rate-limiter": { family: "service" },
  "generic.marketing": { family: "external-api" },
};

const PROCESSOR_SETTINGS: SettingSpec[] = [
  { key: "replicas", unit: "replicas", tier: "main" },
  { key: "concurrency", unit: "slots/replica", tier: "main" },
  { key: "latencyMs", unit: "ms", tier: "main" },
  { key: "failureRate", unit: "%", tier: "main" },
];
/** P1 publishes existing lesson assumptions only. No unverified vendor numbers become defaults. */
export const PROCESSOR_LESSON: Preset = {
  id: "processor-lesson",
  revision: "1",
  values: PROCESSOR_VALUES,
  sources: PROCESSOR_SETTINGS.map(({ key, unit }) => ({
    key,
    unit,
    evidence: "assumption",
    note: "Editable lesson value; measure your workload.",
  })),
};
const compute: FamilySpec = {
  roles: ["processor"],
  defaults: PROCESSOR_LESSON.values,
  settings: PROCESSOR_SETTINGS,
  overLimit: "wait",
};
const store: FamilySpec = {
  roles: ["store"],
  defaults: {},
  settings: [
    { key: "connections", unit: "connections", tier: "advanced" },
    { key: "querySlots", unit: "queries", tier: "advanced" },
  ],
  overLimit: "unknown",
};
const routing: FamilySpec = { roles: ["gateway"], defaults: {}, settings: [], overLimit: "unknown" };
export const FAMILIES: Record<FamilyId, FamilySpec> = {
  service: compute,
  serverless: {
    ...compute,
    overLimit: "reject",
    settings: [
      { key: "maxConcurrency", tier: "main" },
      { key: "latencyMs", unit: "ms", tier: "main" },
      { key: "failureRate", unit: "%", tier: "main" },
      { key: "scaling", tier: "advanced" },
    ],
  },
  workflow: compute,
  "stream-processor": compute,
  "model-api": {
    ...compute,
    overLimit: "reject",
    settings: [
      { key: "latencyMs", unit: "ms", tier: "main" },
      { key: "failureRate", unit: "%", tier: "main" },
      { key: "api", tier: "advanced" },
    ],
  },
  log: { roles: ["topic", "stream"], defaults: {}, settings: [], overLimit: "wait" },
  queue: { roles: ["queue"], defaults: {}, settings: [], overLimit: "wait" },
  pubsub: { roles: ["topic"], defaults: {}, settings: [], overLimit: "wait" },
  sql: store,
  nosql: store,
  cache: store,
  search: store,
  object: store,
  warehouse: store,
  "api-gateway": { ...routing, overLimit: "reject" },
  proxy: routing,
  edge: routing,
  dns: routing,
  mesh: routing,
  device: {
    ...routing,
    settings: [
      { key: "size", tier: "main" },
      { key: "gbps", unit: "Gbps", tier: "main" },
      { key: "messageKB", unit: "kB", tier: "main" },
      { key: "replicas", unit: "replicas", tier: "main" },
    ],
  },
  "external-api": { roles: ["sink"], defaults: {}, settings: [], overLimit: "reject" },
  client: { roles: ["source"], defaults: {}, settings: [], overLimit: "none" },
  scheduler: { roles: ["source"], defaults: {}, settings: [], overLimit: "none" },
  telemetry: { roles: ["sink", "processor"], defaults: {}, settings: [], overLimit: "none" },
  dependency: { roles: ["none", "processor", "source"], defaults: {}, settings: [], overLimit: "none" },
};
export function profileOf(stencil: string | undefined): StencilProfile | undefined {
  return stencil && Object.hasOwn(PROFILES, stencil)
    ? { ...PROFILES[stencil], ...(BROKERS[stencil] ? { broker: BROKERS[stencil] } : {}) }
    : undefined;
}
export function resolvePreset(
  stencil: string | undefined,
  id: unknown,
  revision: unknown,
  size?: unknown,
): Preset | undefined {
  const family = profileOf(stencil)?.family;
  if (
    typeof id === "string" &&
    Object.hasOwn(ADMISSION_PRESETS, id) &&
    revision === ADMISSION_REVISION &&
    (id === "managed-measured" ||
      id === admissionPresetFor(stencil) ||
      (stencil === "stripe" && id === "stripe-sandbox"))
  ) {
    const url =
      id === "lambda-account"
        ? "https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html"
        : id.startsWith("stripe-")
          ? "https://docs.stripe.com/rate-limits"
          : id === "api-gateway-account"
            ? "https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html"
            : undefined;
    return {
      id,
      revision,
      values: ADMISSION_PRESETS[id],
      sources: [
        {
          key: "api",
          unit: undefined,
          evidence: url ? "quota" : "assumption",
          checked: ADMISSION_REVISION,
          url,
          note: url
            ? "Account scope; tier, Region and account exceptions apply. Token-bucket burst is a modelling assumption unless documented."
            : "Limits unknown; enter measured or contracted budgets.",
        },
        {
          key: "latencyMs",
          unit: "ms",
          evidence: "assumption",
          note: "Editable mean duration; measure your workload.",
        },
      ],
    };
  }
  if (family === "device" && id === "device-size" && revision === "1") {
    const values = deviceValues(stencil, size);
    if (values)
      return {
        id,
        revision,
        values,
        sources: [
          {
            key: "gbps",
            unit: "Gbps",
            evidence: stencil?.startsWith("generic.") ? "assumption" : "benchmark",
            note: "Existing approximate device size preset; workload conditions apply.",
            url: "docs/research/network-infrastructure.md",
          },
          { key: "latencyMs", unit: "ms", evidence: "assumption", note: "Existing editable transit service time." },
          {
            key: "messageKB",
            unit: "kB",
            evidence: "assumption",
            note: "Average payload used for the throughput conversion.",
          },
        ],
      };
  }
  return family &&
    FAMILIES[family]?.roles.includes("processor") &&
    id === PROCESSOR_LESSON.id &&
    revision === PROCESSOR_LESSON.revision
    ? PROCESSOR_LESSON
    : undefined;
}
