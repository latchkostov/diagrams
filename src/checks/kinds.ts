import type { SimRole } from "../model/types";
import { stencilRelation } from "../stencils/relations";
import { isDevice } from "../stencils/netDevices";
import { baseStencilId } from "../stencils/vendorParents";

// What the rules need to know about stencils beyond their simulation role: which compute is self-hosted (you run
// its replicas and its front door), which gateways are managed, which clients come from outside, and which stores
// are shared by design. Stencil ids are stable, like rule ids.

/** Compute you run yourself: containers, pods, VMs, a plain service. Serverless and PaaS compute aren't here. */
const SELF_HOSTED_COMPUTE: ReadonlySet<string> = new Set([
  "k8s.pod",
  "k8s.deployment",
  "docker.container",
  "generic.service",
  "grpc",
  "azure.aks",
  "gcp.gke",
  "aws.ecs",
]);

export const isSelfHostedService = (stencil: string) =>
  stencil.startsWith("service.") || SELF_HOSTED_COMPUTE.has(stencil);

/**
 * Gateways you run yourself, with replicas of their own. Managed ones (Front Door, API Gateway, CDNs) aren't here.
 * Network devices (routers, switches, firewalls, ADCs in your racks) are: their replicas are units.
 */
const SELF_HOSTED_GATEWAYS: ReadonlySet<string> = new Set(["nginx", "kong", "envoy", "traefik", "haproxy", "graphql"]);

export const isSelfHostedGateway = (stencil: string) =>
  SELF_HOSTED_GATEWAYS.has(baseStencilId(stencil)) || isDevice(stencil);
export { isDevice };

/**
 * Gateways that aren't a way in for requests: DNS and traffic managers answer a lookup, a service mesh sits beside
 * each service, SignalR is a push hub. Traffic passes them on its way to a real front door.
 */
const NOT_A_FRONT_DOOR: ReadonlySet<string> = new Set([
  "aws.route53",
  "generic.dns",
  "azure.traffic-manager",
  "istio",
  "linkerd",
  "azure.signalr",
]);

export const isFrontDoor = (stencil: string, role: SimRole) =>
  role === "gateway" && !NOT_A_FRONT_DOOR.has(baseStencilId(stencil));

/** People, apps and partners calling in from outside. An on-call engineer (`client.team`) is inside. */
export const isOutsideClient = (stencil: string, role: SimRole) =>
  role === "source" && ((stencil.startsWith("client.") && stencil !== "client.team") || stencil === "generic.webhook");

/** Warehouses, lakes and object storage: shared by many readers and writers on purpose. */
const SHARED_BY_DESIGN: ReadonlySet<string> = new Set([
  "snowflake",
  "databricks",
  "gcp.bigquery",
  "aws.redshift",
  "azure.synapse",
  "microsoft-fabric",
  "generic.warehouse",
  "aws.s3",
  "azure.blob-storage",
  "gcp.cloud-storage",
  "minio",
  "generic.file",
  "adobe.aem",
]);

export const isSharedByDesign = (stencil: string) => SHARED_BY_DESIGN.has(baseStencilId(stencil));

/**
 * Processors that move or use data but own none: connectors, loaders and transforms (they read and write other
 * systems' stores by design), telemetry collectors, and model APIs.
 */
const NOT_A_SERVICE: ReadonlySet<string> = new Set([
  "kafka.connect",
  "airbyte",
  "snowflake.snowpipe",
  "dbt",
  "generic.reverse-etl",
  "azure.data-factory",
  "gcp.dataflow",
  "flink",
  "opentelemetry",
  "openai",
  "anthropic.claude",
  "generic.llm",
  "generic.ml-model",
]);

/** A processor that can own a database: a service, a function, a worker. */
export const isService = (stencil: string, role: SimRole) =>
  role === "processor" && !NOT_A_SERVICE.has(baseStencilId(stencil));

/** The cloud a stencil belongs to, from its id. */
export function cloudOf(stencil: string): "azure" | "aws" | "gcp" | undefined {
  if (stencil.startsWith("azure.")) return "azure";
  if (stencil.startsWith("aws.")) return "aws";
  if (stencil.startsWith("gcp.")) return "gcp";
  return undefined;
}

/**
 * Secret stores a workload signs in to: Key Vault, Vault, Secrets Manager, Secret Manager, a generic one. Kubernetes
 * Secrets aren't here: the kubelet mounts them, so a pod never signs in to read one.
 */
export const isSecretStore = (stencil: string) => stencilRelation(stencil).in === "secret" && stencil !== "k8s.secret";

/**
 * A workload that signs in to things itself: not a store, an identity or anything else a dependency points at (a
 * config store's secret dependency is a reference its reader resolves; App Configuration never calls Key Vault),
 * and not a person or an outside app (`client.*`).
 */
export const isWorkload = (stencil: string) => !stencilRelation(stencil).in && !stencil.startsWith("client.");

/** Each cloud's workload identity: what a service runs as, with no stored credential. */
export const WORKLOAD_IDENTITY = {
  azure: { kind: "azure.managed-identity", noun: "a managed identity", label: "Managed Identity" },
  aws: { kind: "aws.iam-role", noun: "an IAM role", label: "IAM Role" },
  gcp: { kind: "gcp.service-account", noun: "a service account", label: "Service Account" },
} as const;

/** Kafka and the services that run it: their Avro and Protobuf serializers take schemas from a registry. */
const KAFKA_FAMILY: ReadonlySet<string> = new Set(["kafka.topic", "aws.msk", "confluent.cloud"]);

export const isKafkaFamily = (stencil: string) => KAFKA_FAMILY.has(stencil);
