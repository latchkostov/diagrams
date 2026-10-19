import { PROFILES } from "./profileFamilies";
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
  revision: "legacy" | "p1" | "p2" | "p3" | "p3-a1" | "p3-w1";
  preset?: string;
  presetRevision?: string;
  evidence: Preset["sources"];
  units: "real";
}

/** Explicit catalogue coverage, maintained rather than guessed from a vendor name or dispatch role. */
export { PROFILES } from "./profileFamilies";

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
