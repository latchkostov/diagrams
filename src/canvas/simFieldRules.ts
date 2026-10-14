import type { SimRole } from "../model/types";
import type { NodeSimProps } from "../sim/types";

// Which simulation fields the inspector shows: only the ones that can change the run where they are
// (docs/research/sim-flows-review.md, F-28 and F-23). A value already in the file for a field that does nothing
// stays in the file and is said in a muted note instead, with a way to remove it.

type SimKey = keyof NodeSimProps;

/** Which simulation tunables apply to each role. */
export const SIM_FIELDS_BY_ROLE: Record<SimRole, SimKey[]> = {
  source: ["ratePerSec", "messageType"],
  processor: ["replicas", "latencyMs", "concurrency", "failureRate", "emits"],
  // A gateway takes any number at once (its concurrency is unlimited in the engine).
  gateway: ["latencyMs"],
  store: ["latencyMs"],
  // A sink finishes each message as it arrives.
  sink: [],
  topic: ["partitions", "maxDeliveryCount"],
  stream: ["partitions", "maxDeliveryCount"],
  queue: ["maxDeliveryCount"],
  none: [],
};

/** Fields a role has no use for, with why (the end of "…, but {why}, so it doesn't change the run"). */
const INERT_BY_ROLE: Partial<Record<SimRole, Partial<Record<SimKey, string>>>> = {
  gateway: { concurrency: "a gateway takes any number of messages at once in the simulation" },
  sink: { latencyMs: "a sink finishes each message the moment it arrives" },
};

/** The node's props that are set but can't change the run for its role, in a stable order. */
export function inertNodeProps(role: SimRole, props: Record<string, unknown>): { key: SimKey; why: string }[] {
  return Object.entries(INERT_BY_ROLE[role] ?? {})
    .filter(([key]) => props[key] !== undefined)
    .map(([key, why]) => ({ key: key as SimKey, why }));
}

/**
 * Which of a flow edge's fields can change the run, from the role of the node it leaves: a consumer group only
 * out of a topic or stream (a queue's consumers always compete), a dead-letter route only out of a broker (a
 * service's "dead-letter" edge is never used for its failures, and carries nothing).
 */
export function edgeSimFields(sourceRole: SimRole | undefined): { group: boolean; dlq: boolean } {
  const grouped = sourceRole === "topic" || sourceRole === "stream";
  return { group: grouped, dlq: grouped || sourceRole === "queue" };
}
