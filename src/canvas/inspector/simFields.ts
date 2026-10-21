import { t } from "../../i18n";
import { SIM_LIMITS } from "../../interop/native";
import type { NodeSimProps } from "../../sim/types";

// Right-hand properties panel. Every edit goes through EditorApi (so it is undoable); typing
// is coalesced per field via the `merge` option.

export type SimKey = keyof NodeSimProps;

export interface SimField {
  label: string;
  unit?: string;
  /** "map": one type, or `In → Out, In2 → Out2` (or JSON) for a map. "list": comma-separated strings. */
  kind: "number" | "text" | "map" | "list";
  min?: number;
  max?: number;
  step?: number;
  placeholder: string;
  hint: string;
  /** A line shown under the field, for what people get wrong about it. */
  note?: string;
}

// Partial on purpose: engine knobs without a designed field yet stay editable under "Custom properties". Bounds are
// the file format's (SIM_LIMITS): a value the inspector takes always saves and opens again.
export const SIM_FIELDS: Partial<Record<SimKey, SimField>> = {
  ratePerSec: {
    get label() {
      return t("inspector.rate");
    },
    unit: "msg/s",
    kind: "number",
    min: 0,
    max: SIM_LIMITS.ratePerSec,
    step: 0.5,
    placeholder: "2",
    get hint() {
      return t("inspector.messagesPerSecondWhileTrafficIsOn");
    },
  },
  messageType: {
    get label() {
      return t("inspector.messageType");
    },
    kind: "text",
    get placeholder() {
      return t("inspector.derivedFromLabel");
    },
    get hint() {
      return t("inspector.typeEmittedByThisSource");
    },
  },
  latencyMs: {
    get label() {
      return t("inspector.latency");
    },
    unit: "ms",
    kind: "number",
    min: 0,
    max: SIM_LIMITS.timeMs,
    step: 10,
    get placeholder() {
      return t("inspector.default");
    },
    get hint() {
      return t("inspector.processingTimePerMessage");
    },
  },
  concurrency: {
    get label() {
      return t("inspector.concurrency");
    },
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "4",
    get hint() {
      return t("inspector.messagesProcessedInParallelPerReplica");
    },
  },
  replicas: {
    get label() {
      return t("inspector.replicas");
    },
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "1",
    hint: "",
  },
  jitter: {
    get label() {
      return t("inspector.latencyJitter");
    },
    unit: "0–1",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.05,
    placeholder: "0.2",
    get hint() {
      return t("inspector.randomSpreadOnLatency0220");
    },
  },
  failureRate: {
    get label() {
      return t("inspector.failureRate");
    },
    unit: "0–1",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.05,
    placeholder: "0",
    get hint() {
      return t("inspector.probabilityAMessageFailsProcessing");
    },
  },
  maxDeliveryCount: {
    get label() {
      return t("inspector.maxDeliveries");
    },
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "3",
    get hint() {
      return t("inspector.attemptsBeforeDeadLettering");
    },
  },
  partitions: {
    get label() {
      return t("inspector.partitions");
    },
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "3",
    get hint() {
      return t("inspector.maxInFlightDeliveriesPerConsumerGroup");
    },
    get note() {
      return t("inspector.howManyConsumersInOneGroupCanWorkIn");
    },
  },
  emits: {
    get label() {
      return t("inspector.emits");
    },
    kind: "map",
    get placeholder() {
      return t("inspector.unchangedOrInOutOther");
    },
    get hint() {
      return t("inspector.messageTypeSentDownstreamOneNameRenamesEverythingOrderplaced");
    },
  },
};

export const SIM_KEYS = new Set<string>(Object.keys(SIM_FIELDS));

// A setting leaves Custom properties only where a control for it shows: a device's own section, a firewall's rule.
// Anywhere else (an nginx with a `gbps`, a service's connection with `deny`) it stays there, to see, change or remove.
export const DEVICE_KEYS = new Set<string>([...SIM_KEYS, "size", "gbps", "messageKB", "ha", "failoverMs"]);

export const ADC_KEYS = new Set<string>([...DEVICE_KEYS, "healthChecks"]);

export const EDGE_KEYS = new Set([
  "group",
  "dlq",
  "travelMs",
  "filter",
  "emits",
  "share",
  "settings",
  "caller",
  "requestFilter",
]);

export const RULE_KEYS = new Set([...EDGE_KEYS, "deny"]);

/** Number / text input that keeps a local draft so partially typed numbers ("0.") survive. */
export function showSim(kind: SimField["kind"], value: unknown): string {
  if (value === undefined || value === null) return "";
  if (kind === "list" && Array.isArray(value)) return value.join(", ");
  if (kind === "map" && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} → ${String(v)}`)
      .join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
