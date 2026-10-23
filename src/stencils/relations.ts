import { baseStencilId } from "./vendorParents";
import type { EdgeRelation } from "../model/types";
import { RELATION_META, relationOf, type DependencyRelation } from "../model/relations";

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
  (stencilId && STENCIL_RELATIONS[baseStencilId(stencilId)]) || {};

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

// ---------------------------------------------------------------- a stencil changes

/** One edge whose relationship follows its ends' new stencils. */
export interface RelationChange {
  id: string;
  from: EdgeRelation;
  to: EdgeRelation;
}

interface EdgeEnds {
  id: string;
  from: string;
  to: string;
  relation?: unknown;
  relationOrigin?: unknown;
}

/**
 * The edges of `changed` nodes whose relationship follows their ends' stencils now (`stencilOf` gives the new
 * ones). A flow becomes the dependency its ends imply (a node turned into App Configuration: its incoming flows
 * become Config), unless someone made it a flow on purpose (`relationOrigin: "explicit"`). A dependency changes
 * only when it was inferred: back to a flow when the node stops being such a stencil, or to the dependency the
 * new stencil implies. A dependency set on purpose, or one with no origin (a file written by hand), stays.
 */
export function reinferRelations(
  edges: readonly EdgeEnds[],
  stencilOf: (nodeId: string) => string | undefined,
  changed: ReadonlySet<string>,
): RelationChange[] {
  const out: RelationChange[] = [];
  for (const e of edges) {
    if ((!changed.has(e.from) && !changed.has(e.to)) || e.relationOrigin === "explicit") continue;
    const now = relationOf(e);
    if (now !== "flow" && e.relationOrigin !== "inferred") continue;
    const want = inferRelation(stencilOf(e.from), stencilOf(e.to));
    if (want !== now) out.push({ id: e.id, from: now, to: want });
  }
  return out;
}

/**
 * What re-inferred edges are now, in one line: "2 connections are now Config: no messages flow over them", "1
 * connection is a flow again: messages flow over it in Live". Empty for no changes.
 */
export function relationChangeText(changes: readonly RelationChange[]): string {
  const n = changes.length;
  if (!n) return "";
  const subject = n === 1 ? "1 connection is" : `${n} connections are`;
  const them = n === 1 ? "it" : "them";
  const targets = new Set(changes.map((c) => c.to));
  if (targets.size === 1 && targets.has("flow"))
    return `${n === 1 ? "1 connection is a flow" : `${n} connections are flows`} again: messages flow over ${them} in Live`;
  if (targets.has("flow")) return `${n} connections changed relationship to match their stencils`;
  const [only] = targets as Set<DependencyRelation>;
  const what = targets.size === 1 ? RELATION_META[only].label : "dependencies";
  return `${subject} now ${what}: no messages flow over ${them}`;
}
