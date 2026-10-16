import { autoscalingProblem, checkAutoscaling } from "../model/autoscalingSchema";
import type { ComputeResources, AutoscalingConfig } from "../model/autoscaling";
import { resourceWorkload } from "../model/autoscaling";
import type { DiagramFile, DiagramNode, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import {
  DEFAULT_FAILOVER_MS,
  DEFAULT_MESSAGE_KB,
  deviceSpec,
  isDeviceHa,
  presetOf,
  sizeOf,
  messagesPerSec,
  type DeviceHa,
  type DeviceKind,
  type DevicePreset,
  type DeviceSize,
} from "../stencils/netDevices";
import { brokerSpec, type BrokerSpec } from "../model/brokers";
import type { NodeSimProps } from "./types";
import { profileOf, resolvePreset, FAMILIES, PROCESSOR_LESSON, type ResolutionEvidence } from "../stencils/profiles";
import type { PlanningModel } from "../model/types";
import type { AdmissionPolicy } from "./admission";
import { admissionPresetFor, ADMISSION_REVISION } from "../model/admissionPresets";
import { validAdmissionData } from "../model/admissionSchema";

/** Only these roles spend service time, including paused and resumed work. */
export const hasServiceTime = (role: SimRole): boolean =>
  role === "processor" || role === "store" || role === "gateway";
const metadataNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

type DeviceKey = "size" | "gbps" | "messageKB" | "ha" | "failoverMs" | "healthChecks";

/** A network device's settings, its size preset's values under the node's own. */
export interface ResolvedDevice {
  /** Undefined for a gateway that only has an explicit `gbps`. */
  kind?: DeviceKind;
  size?: DeviceSize;
  preset?: DevicePreset;
  gbps: number;
  messageKB: number;
  ha: DeviceHa;
  failoverMs: number;
  /** Real messages per second one unit carries. */
  perUnit: number;
}

export type ResolvedProps = Required<
  Omit<
    NodeSimProps,
    | "resources"
    | "autoscaling"
    | "resumeAutoscaling"
    | "api"
    | "endpoints"
    | "scaling"
    | "maxConcurrency"
    | "emits"
    | DeviceKey
    | "preset"
    | "presetRevision"
    | "connections"
    | "querySlots"
    | "ingestUnits"
  >
> &
  Pick<NodeSimProps, "emits"> & {
    resources?: ComputeResources;
    autoscaling?: AutoscalingConfig;
    autoscalingProblem?: string;
    healthChecks: boolean;
    /** Gateways with a throughput ceiling: network device stencils, or any gateway given `gbps`. */
    device?: ResolvedDevice;
    /** Metadata only: never changes dispatch or sampling units. */
    profile: ResolutionEvidence;
    broker?: BrokerSpec & { messageKB?: number; ingestUnits?: number };
    admission?: AdmissionPolicy;
  };

/** Ignore malformed free-form diagram props rather than poisoning the clock. `stencil` adds a device's presets. */
export function resolveProps(
  role: SimRole,
  label: string,
  props: Record<string, unknown>,
  stencil: string | undefined,
  planning: PlanningModel | undefined,
  previousAdmission?: AdmissionPolicy,
): ResolvedProps {
  const authored = props;
  const profile = profileOf(stencil);
  const compatible = !!profile && FAMILIES[profile.family].roles.includes(role);
  const pinned =
    !!planning && compatible
      ? resolvePreset(
          stencil,
          props.preset ??
            (planning.revision === "p3" || planning.revision === "p3-a1" ? admissionPresetFor(stencil) : undefined),
          props.presetRevision ??
            ((planning.revision === "p3" || planning.revision === "p3-a1") && !props.preset
              ? ADMISSION_REVISION
              : undefined),
          props.size,
        )
      : undefined;
  props = {
    ...(!!planning && compatible && profile ? FAMILIES[profile.family].defaults : {}),
    ...pinned?.values,
    ...props,
  };
  const number = (key: string, fallback: number, min = 0, max = Infinity) => {
    const value = props[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  };
  const device = role === "gateway" ? resolveDevice(props, number, stencil) : undefined;
  const devicePreset = device ? resolvePreset(stencil, "device-size", "1", device.size) : undefined;
  const evidencePreset = pinned ?? devicePreset;
  const ha = device?.ha ?? "standalone";
  const broker = brokerSpec(stencil, role, planning);
  const managed =
    (planning?.revision === "p3" || planning?.revision === "p3-a1") &&
    ((compatible &&
      (profile?.family === "serverless" ||
        profile?.family === "external-api" ||
        profile?.family === "model-api" ||
        profile?.family === "api-gateway")) ||
      ((props.api !== undefined || props.endpoints !== undefined) && (hasServiceTime(role) || role === "sink")));
  const invalidAdmission =
    previousAdmission?.invalid ?? (managed && !previousAdmission && !validAdmissionData(props.api, props.endpoints));
  const api =
    managed && !invalidAdmission && props.api && typeof props.api === "object" && !Array.isArray(props.api)
      ? (props.api as NonNullable<NodeSimProps["api"]>)
      : {};
  const allocation = metadataNumber(props.maxConcurrency);
  const fixedWorker = role === "processor" && profile?.family !== "model-api";
  const automatic = profile?.family === "serverless" && props.scaling === "auto";
  // Fleet slots are derived after capacity multiplication and partition assignment.
  const effectiveSlots = fixedWorker ? allocation : undefined;
  const endpoints =
    !invalidAdmission && Array.isArray(props.endpoints)
      ? (props.endpoints as NonNullable<NodeSimProps["endpoints"]>)
      : [];
  const stripeScope =
    stencil === "stripe" && pinned?.id?.startsWith("stripe-")
      ? api.quotas?.find((q) => q.sharedGroup)?.sharedGroup
      : undefined;
  const resolvedEndpoints =
    previousAdmission?.endpoints ??
    endpoints.map((endpoint) =>
      stripeScope && endpoint.behaviour?.quotas === undefined
        ? {
            ...endpoint,
            behaviour: {
              ...endpoint.behaviour,
              quotas: [
                {
                  id: "endpoint-rate",
                  unit: "requests" as const,
                  amount: 25,
                  windowMs: 1000,
                  algorithm: "token-bucket" as const,
                  sharedGroup: `${stripeScope}:${endpoint.method}:${endpoint.path}`,
                },
              ],
            },
          }
        : endpoint,
    );
  const metadata = (key: string) =>
    typeof props[key] === "number" && Number.isFinite(props[key]) && props[key] > 0 ? props[key] : undefined;
  const a1 =
    planning?.revision === "p3-a1" &&
    role === "processor" &&
    resourceWorkload(
      stencil,
      profile?.family,
      (props.resources as ComputeResources | undefined)?.modelRevision ?? "a1",
    );
  let validResources = true;
  try {
    checkAutoscaling(props.resources);
  } catch {
    validResources = false;
  }
  const problem =
    planning?.revision === "p3-a1" && (props.resources || props.autoscaling)
      ? a1
        ? autoscalingProblem(props.resources, props.autoscaling)
        : "Native managed allocation owns scaling; HPA requires a service workload."
      : undefined;
  return {
    autoscalingProblem: problem,
    ...(a1
      ? {
          resources: validResources ? (props.resources as ComputeResources | undefined) : undefined,
          autoscaling: problem ? undefined : (props.autoscaling as AutoscalingConfig | undefined),
          autoscalingProblem: problem,
        }
      : {}),
    ...(managed
      ? {
          admission: {
            ...(invalidAdmission ? { invalid: true } : {}),
            requirementsPolicy: previousAdmission?.requirementsPolicy ?? previousAdmission,
            api: previousAdmission?.api ?? api,
            endpoints: resolvedEndpoints,
            slots: effectiveSlots,
            fixedSlotsPerReplica: fixedWorker && !automatic ? number("concurrency", 4) : undefined,
            accountConcurrency:
              pinned?.values.api?.sharedConcurrency === api.sharedConcurrency
                ? pinned?.values.api?.maxInFlight
                : undefined,
          },
        }
      : {}),
    broker: broker
      ? {
          ...broker,
          ...(metadata("messageKB") !== undefined ? { messageKB: metadata("messageKB") } : {}),
          ...(metadata("ingestUnits") !== undefined ? { ingestUnits: metadata("ingestUnits") } : {}),
        }
      : undefined,
    profile: {
      family: profile?.family,
      revision: planning?.revision ?? "legacy",
      preset: pinned?.id,
      presetRevision: pinned?.revision,
      evidence: (evidencePreset?.sources ?? (role === "processor" ? PROCESSOR_LESSON.sources : [])).map((source) => ({
        ...source,
        ...(authored[source.key] !== undefined &&
        JSON.stringify(authored[source.key]) !== JSON.stringify(evidencePreset?.values[source.key])
          ? { evidence: "assumption" as const, note: "Configured workload assumption." }
          : {}),
      })),
      units: "real",
    },
    ratePerSec: number("ratePerSec", 2),
    latencyMs:
      hasServiceTime(role) || managed
        ? number(
            "latencyMs",
            device?.preset
              ? device.preset.latencyMs
              : role === "processor"
                ? 250
                : role === "gateway"
                  ? 60
                  : role === "store"
                    ? 40
                    : managed
                      ? 250
                      : 0,
          )
        : 0,
    concurrency: role === "processor" ? Math.floor(number("concurrency", 4)) : Infinity,
    // An HA pair or cluster starts at two units.
    replicas: Math.max(1, Math.floor(number("replicas", ha === "standalone" ? 1 : 2, 1))),
    jitter: number("jitter", 0.2, 0, 1),
    retry: props.retry === "inplace" ? "inplace" : "requeue",
    retryBackoffMs: number("retryBackoffMs", 0),
    failureRate: number("failureRate", 0, 0, 1),
    maxDeliveryCount: Math.floor(number("maxDeliveryCount", 3, 1)),
    partitions: Math.floor(number("partitions", 3, 1)),
    emits:
      typeof props.emits === "string"
        ? props.emits
        : props.emits && typeof props.emits === "object" && !Array.isArray(props.emits)
          ? Object.fromEntries(
              Object.entries(props.emits).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            )
          : undefined,
    messageType: typeof props.messageType === "string" ? props.messageType : label || "Message",
    healthChecks:
      typeof props.healthChecks === "boolean" ? props.healthChecks : role === "gateway" && device?.kind === "adc",
    ...(device ? { device } : {}),
  };
}

/** Resolve a node in its document; overrides remain partial updates. */
export function resolveNodeProps(
  d: DiagramFile,
  node: DiagramNode,
  overrides?: Record<string, unknown>,
): ResolvedProps {
  return resolveProps(stencilRole(node.stencil), node.label, { ...node.props, ...overrides }, node.stencil, d.planning);
}

/** Explicit legacy resolution for old-format probes and migration. */
export function resolveLegacyProps(role: SimRole, label: string, props: Record<string, unknown>, stencil?: string) {
  return resolveProps(role, label, props, stencil, undefined);
}

function resolveDevice(
  props: Record<string, unknown>,
  number: (key: string, fallback: number, min?: number, max?: number) => number,
  stencil: string | undefined,
): ResolvedDevice | undefined {
  const spec = deviceSpec(stencil);
  const explicit = typeof props.gbps === "number" && Number.isFinite(props.gbps);
  if (!spec && !explicit) return undefined;
  const size = spec ? sizeOf(spec, props.size) : undefined;
  const preset = spec && size ? presetOf(spec, size) : undefined;
  const gbps = number("gbps", preset?.gbps ?? 0);
  const messageKB = number("messageKB", DEFAULT_MESSAGE_KB, 0.01);
  return {
    ...(spec ? { kind: spec.kind, size, preset } : {}),
    gbps,
    messageKB,
    ha: isDeviceHa(props.ha) ? props.ha : "standalone",
    failoverMs: number("failoverMs", DEFAULT_FAILOVER_MS),
    // Zero Gbps carries nothing; the ceiling is real messages per second.
    perUnit: messagesPerSec(gbps, messageKB),
  };
}
