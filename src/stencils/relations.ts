import type { EdgeRelation } from "../model/types";
import type { DependencyRelation } from "../model/relations";

// The relationship a new edge takes from the stencils at its ends (docs/research/diagram-semantics.md
// §2.4): `in` for an edge INTO the stencil, `out` for an edge OUT OF it. Only strongly typed stencils
// have one, so edges between services, brokers and stores always stay flows.

export interface StencilRelation {
  in?: DependencyRelation;
  out?: DependencyRelation;
}

const SECRET_STORES = ["azure.key-vault", "vault", "aws.secrets-manager", "gcp.secret-manager", "k8s.secret"];
const SECRET_GENERIC = ["generic.secret-store"];
const CONFIG_STORES = ["azure.app-config", "aws.parameter-store", "k8s.configmap", "generic.config-store"];
const IDENTITIES = [
  "entra-id",
  "okta",
  "auth0",
  "keycloak",
  "azure.managed-identity",
  "aws.iam-role",
  "gcp.service-account",
  "generic.identity-provider",
];
// Every observability stencil except the OpenTelemetry Collector, which is often a real pipeline hop.
const TELEMETRY = [
  "grafana",
  "prometheus",
  "datadog",
  "azure.app-insights",
  "splunk",
  "loki",
  "jaeger",
  "kibana",
  "new-relic",
  "sentry",
  "aws.cloudwatch",
];
const DEPLOYERS = ["github-actions", "argocd", "terraform"];
const DEPENDS = ["kafka.schema-registry", "generic.dns"];

export const STENCIL_RELATIONS: Readonly<Record<string, StencilRelation>> = Object.fromEntries([
  ...[...SECRET_STORES, ...SECRET_GENERIC].map((id) => [id, { in: "secret" }] as const),
  ...CONFIG_STORES.map((id) => [id, { in: "config" }] as const),
  ...IDENTITIES.map((id) => [id, { in: "identity" }] as const),
  ...TELEMETRY.map((id) => [id, { in: "telemetry" }] as const),
  ...DEPLOYERS.map((id) => [id, { out: "deploy" }] as const),
  ...DEPENDS.map((id) => [id, { in: "depends" }] as const),
]);

export const stencilRelation = (stencilId: string | undefined): StencilRelation =>
  (stencilId && STENCIL_RELATIONS[stencilId]) || {};

/**
 * The relationship for a new edge from `source` to `target` (stencil ids). The target's `in` wins,
 * except that a deploy source always wins: a pipeline writing to Key Vault deploys it, it doesn't
 * read a secret. Untyped ends (services, brokers, stores, shapes) give a flow.
 */
export function inferRelation(source: string | undefined, target: string | undefined): EdgeRelation {
  const out = stencilRelation(source).out;
  if (out === "deploy") return "deploy";
  return stencilRelation(target).in ?? out ?? "flow";
}
