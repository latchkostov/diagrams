import type { DiagramOp } from "../../ai";
import type { DiagramNode } from "../../model/types";
import { isBroker, listNames, type CheckContext } from "../context";
import type { CheckFix, CheckRule, Finding } from "../types";

// 1. dead-letter: a broker whose consumers' failed messages are dropped, because there's no dead-letter
// route out of it or out of those consumers. A Warning when a consumer can fail in this diagram (a failure
// rate; see failureEvidence); a
// Suggestion for a queue without that evidence; nothing for a topic or stream without it (projections and
// connectors replay from the log, so a missing DLT is often deliberate).

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Why consumer `id` can fail messages in this diagram, in words, or undefined when nothing says it can: a
 * failure rate on the node, or one a saved simulation sets (in its setup or on its timeline). A consumer
 * that's down or paused isn't evidence: the broker holds its messages (lag, not loss), in the simulation as
 * on a real broker.
 */
export function failureEvidence(ctx: CheckContext, id: string): string | undefined {
  const node = ctx.nodes.get(id)!;
  if (positive(node.props?.failureRate)) return `fails ${pct(node.props!.failureRate as number)} of messages`;
  for (const sim of ctx.diagram.simulations ?? []) {
    const fails =
      positive(sim.setup?.props?.[id]?.failureRate) ||
      (sim.timeline ?? []).some(({ action: a }) => a.do === "props" && a.node === id && positive(a.props.failureRate));
    if (fails) return `fails messages in “${sim.title}”`;
  }
  return undefined;
}

/** The dead-letter queue for a broker of this family, named the way that family names them. */
export function deadLetterFor(broker: DiagramNode): { kind: string; label: string; sublabel?: string } {
  const name = broker.label.trim() || broker.id;
  const s = broker.stencil;
  if (s.startsWith("azure.service-bus."))
    return { kind: "azure.service-bus.queue", label: `${name} DLQ`, sublabel: "$DeadLetterQueue" };
  if (s === "aws.sqs" || s === "aws.sns" || s === "aws.eventbridge") return { kind: "aws.sqs", label: `${name}-dlq` };
  if (s === "kafka.topic" || s === "confluent.cloud" || s === "aws.msk")
    return { kind: "kafka.topic", label: `${name}.dlq` };
  if (s.startsWith("rabbitmq."))
    return { kind: "rabbitmq.queue", label: `${name}.dlq`, sublabel: "dead-letter exchange" };
  if (s === "gcp.pubsub") return { kind: "gcp.pubsub", label: `${name}-dlq` };
  if (s === "pulsar.topic") return { kind: "pulsar.topic", label: `${name}-DLQ` };
  return { kind: "generic.queue", label: `${name} DLQ` };
}

/** Add a broker of the same family, connected by a dead-letter route: one batch, one undo step. */
export function addDeadLetterQueue(ctx: CheckContext, broker: DiagramNode): CheckFix {
  const dlq = deadLetterFor(broker);
  const node = ctx.freshKey("new-dlq");
  const route = ctx.freshKey("new-dlq-route");
  const ops: DiagramOp[] = [
    {
      op: "add_node",
      kind: dlq.kind,
      label: dlq.label,
      ...(dlq.sublabel ? { sublabel: dlq.sublabel } : {}),
      key: node,
    },
    { op: "connect", from: broker.id, to: node, kind: "async", label: "dead letters", key: route },
    { op: "update", target: route, props: { dlq: true } },
  ];
  return { label: "Add dead-letter queue", ops };
}

const DLQ_WORDS = /dlq|dead.?letter/i;
/** A broker that is itself a dead-letter queue: a DLQ route's target, marked as one, or named like one. */
export function isDeadLetterQueue(ctx: CheckContext, id: string): boolean {
  const node = ctx.nodes.get(id)!;
  return (
    ctx.incoming(id).some((e) => e.dlq) ||
    node.props?.isDeadLetter === true ||
    DLQ_WORDS.test(`${node.label} ${node.sublabel ?? ""}`)
  );
}

export const deadLetter: CheckRule = {
  id: "dead-letter",
  name: "Failed messages are dropped",
  about:
    "A message that keeps failing is redelivered up to the broker's delivery limit, then dropped unless there's a dead-letter route. " +
    "Fires for a broker with consumers and no dead-letter route: a warning when a consumer can fail in this diagram, a suggestion for a queue.",
  detect(ctx) {
    const out: Finding[] = [];
    for (const broker of ctx.diagram.nodes) {
      const id = broker.id;
      if (!isBroker(ctx, id) || isDeadLetterQueue(ctx, id)) continue;
      const consumers = [
        ...new Set(
          ctx
            .routes(id)
            .map((e) => e.to)
            .filter((to) => ctx.role(to) === "processor"),
        ),
      ];
      if (!consumers.length) continue;
      const handled = ctx.hasDeadLetterRoute(id) || consumers.some(ctx.hasDeadLetterRoute);
      if (handled) continue;
      const failing = consumers.flatMap((c) => {
        const why = failureEvidence(ctx, c);
        return why ? [{ id: c, why }] : [];
      });
      const name = ctx.name(id);
      const limit = broker.props?.maxDeliveryCount;
      const deliveries = typeof limit === "number" && limit >= 1 ? Math.floor(limit) : 3;
      const rationale =
        "A message that keeps failing is redelivered up to the broker's delivery limit, then goes to the dead-letter route, or is dropped when there isn't one. A dead-letter queue keeps it to inspect and replay.";
      if (failing.length) {
        const first = failing[0];
        out.push({
          id: `dead-letter:${id}`,
          rule: "dead-letter",
          severity: "warning",
          target: id,
          elements: [id, ...failing.map((f) => f.id)],
          title: "Failed messages are dropped",
          message: `${ctx.name(first.id)} ${first.why}${failing.length > 1 ? ` (and ${failing.length - 1} more consumer${failing.length > 2 ? "s" : ""} can fail)` : ""}, and ${name} has no dead-letter queue: messages that run out of deliveries (${deliveries}) are lost.`,
          rationale,
          fix: addDeadLetterQueue(ctx, broker),
        });
      } else if (ctx.role(id) === "queue") {
        out.push({
          id: `dead-letter:${id}`,
          rule: "dead-letter",
          severity: "suggestion",
          target: id,
          elements: [id, ...consumers],
          title: `${name} has no dead-letter queue`,
          message: `If ${listNames(consumers.map(ctx.name))} can't handle a message, it's dropped after ${deliveries} deliveries. A command queue is where losing messages hurts most.`,
          rationale,
          fix: addDeadLetterQueue(ctx, broker),
        });
      }
    }
    return out;
  },
};
