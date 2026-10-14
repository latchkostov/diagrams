import type { DiagramNode } from "../model/types";

/** edit_diagram's add_node label limit. */
const MAX_LABEL = 200;

/**
 * The dead-letter queue for a broker of this family, named the way that family names them: the dead-letter check's
 * fix and live view's "losing messages" callout add the same one.
 */
export function deadLetterFor(broker: DiagramNode): { kind: string; label: string; sublabel?: string } {
  const name = broker.label.trim() || broker.id;
  // The name, shortened so name and suffix fit an edit op's label (200 characters).
  const named = (suffix: string) => `${name.slice(0, MAX_LABEL - suffix.length).trimEnd()}${suffix}`;
  const s = broker.stencil;
  if (s.startsWith("azure.service-bus."))
    return { kind: "azure.service-bus.queue", label: named(" DLQ"), sublabel: "$DeadLetterQueue" };
  if (s === "aws.sqs" || s === "aws.sns" || s === "aws.eventbridge") return { kind: "aws.sqs", label: named("-dlq") };
  if (s === "kafka.topic" || s === "confluent.cloud" || s === "aws.msk")
    return { kind: "kafka.topic", label: named(".dlq") };
  if (s.startsWith("rabbitmq."))
    return { kind: "rabbitmq.queue", label: named(".dlq"), sublabel: "dead-letter exchange" };
  if (s === "gcp.pubsub") return { kind: "gcp.pubsub", label: named("-dlq") };
  if (s === "pulsar.topic") return { kind: "pulsar.topic", label: named("-DLQ") };
  return { kind: "generic.queue", label: named(" DLQ") };
}
