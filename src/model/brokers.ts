import { revisionAtLeast } from "./revisions";
import type { PlanningModel, SimRole } from "./types";

/** Small behavioural metadata shared by profiles, playback, planning and inspector chrome. */
export interface BrokerSpec {
  partitioned: boolean;
  assignment: "partitions" | "shards" | "subscriptions" | "bindings";
  group: "group" | "subscription" | "binding";
  /** Reserved metadata units; no vendor ingest ceiling is enforced. */
  ingestUnit: "MB/s" | "throughput-units" | "messages/s";
  producerSizeUnit: "kB";
}
export interface ConsumerAssignment {
  count: number;
  spec?: BrokerSpec;
}
/** Deterministic English for analysis and agent contracts; UI vocabulary is translated at presentation. */
export const englishAssignmentLabel = (spec?: BrokerSpec) => {
  const noun = spec?.assignment ?? "partitions";
  return noun[0].toUpperCase() + noun.slice(1);
};
/** The largest usable fleet wins; ties use vocabulary order so edge order never changes the explanation. */
export function recordAssignment(
  assignments: Map<string, ConsumerAssignment>,
  id: string,
  count: number,
  spec?: BrokerSpec,
) {
  const previous = assignments.get(id);
  if (
    !previous ||
    count > previous.count ||
    (count === previous.count && (spec?.assignment ?? "") < (previous.spec?.assignment ?? ""))
  )
    assignments.set(id, { count, spec });
}
const log: BrokerSpec = {
  partitioned: true,
  assignment: "partitions",
  group: "group",
  ingestUnit: "MB/s",
  producerSizeUnit: "kB",
};
const pubsub: BrokerSpec = {
  partitioned: false,
  assignment: "subscriptions",
  group: "subscription",
  ingestUnit: "messages/s",
  producerSizeUnit: "kB",
};
export const BROKERS: Readonly<Record<string, BrokerSpec>> = {
  "kafka.topic": log,
  "azure.event-hubs": { ...log, ingestUnit: "throughput-units" },
  "aws.kinesis": { ...log, assignment: "shards" },
  "redis.stream": log,
  "confluent.cloud": log,
  "pulsar.topic": log,
  "aws.msk": log,
  "generic.event-store": log,
  "azure.service-bus.topic": pubsub,
  "azure.event-grid": pubsub,
  "rabbitmq.exchange": { ...pubsub, assignment: "bindings", group: "binding" },
  "aws.sns": pubsub,
  "aws.eventbridge": pubsub,
  "gcp.pubsub": pubsub,
  "nats.subject": pubsub,
  "mqtt.broker": pubsub,
  "generic.topic": pubsub,
};
/** Old documents keep their original role-based assignment until explicitly upgraded. */
export function brokerSpec(
  stencil: string | undefined,
  role: SimRole,
  planning?: PlanningModel,
): BrokerSpec | undefined {
  if (role !== "topic" && role !== "stream") return undefined;
  return revisionAtLeast(planning?.revision, "p2") && stencil && Object.hasOwn(BROKERS, stencil)
    ? BROKERS[stencil]
    : log;
}
/** Infrastructure, never a topic or an extra delivery hop. */
export const isClusterWrapper = (stencil: string) => stencil === "kafka.cluster";
