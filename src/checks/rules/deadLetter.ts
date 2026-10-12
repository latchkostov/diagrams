import type { DiagramOp } from "../../ai";
import type { DiagramNode } from "../../model/types";
import { acceptsType, type CompiledEdge } from "../../sim/topology";
import { isBroker, listNames, type CheckContext } from "../context";
import type { CheckFix, CheckRule, Finding } from "../types";

// 1. dead-letter: a broker whose consumers' failed messages are dropped, because it has no effective
// dead-letter route: playback sends a message that runs out of deliveries down the broker's own first
// dead-letter route when that route's filter takes its type, and drops it otherwise, whether the consumer
// requeues or retries in place (deadLetterRoutes, src/sim/topology.ts). A consumer's own dead-letter edge
// catches nothing. A Warning when a consumer can fail in this diagram (a failure rate; see failureEvidence); a
// Suggestion for a queue without that evidence; nothing for a topic or stream without it (projections and
// connectors replay from the log, so a missing DLT is often deliberate).

/** edit_diagram's add_node label limit. */
const MAX_LABEL = 200;
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

/**
 * Which failed messages the broker's dead-letter route misses, as playback routes them: undefined when it
 * catches every type that reaches the broker (in free play or a saved simulation); otherwise the route (if
 * any) and the types it lets drop.
 */
export function deadLetterGap(ctx: CheckContext, id: string): { route?: CompiledEdge; missed: string[] } | undefined {
  const route = ctx.deadLetterRoute(id);
  if (!route) return { missed: [] };
  if (!route.filter) return undefined;
  const types = [...ctx.typesAt(id)];
  // No known traffic: a filter that takes nothing still takes nothing; any other gets the benefit of the doubt.
  if (!types.length) return route.filter.length ? undefined : { route, missed: [] };
  const missed = types.filter((type) => !acceptsType(route.filter, type));
  return missed.length ? { route, missed } : undefined;
}

export const deadLetter: CheckRule = {
  id: "dead-letter",
  name: "Failed messages are dropped",
  about:
    "A message that keeps failing is redelivered up to the broker's delivery limit, then dropped unless there's a dead-letter route. " +
    "Fires for a broker with consumers and no dead-letter route that takes their failed messages: a warning when a consumer can fail in this diagram, a suggestion for a queue.",
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
      const gap = deadLetterGap(ctx, id);
      if (!gap) continue;
      const failing = consumers.flatMap((c) => {
        const why = failureEvidence(ctx, c);
        return why ? [{ id: c, why }] : [];
      });
      const name = ctx.name(id);
      const limit = broker.props?.maxDeliveryCount;
      const deliveries = typeof limit === "number" && limit >= 1 ? Math.floor(limit) : 3;
      const rationale =
        "A message that keeps failing is redelivered up to the broker's delivery limit, then goes to the broker's dead-letter route, or is dropped when there isn't one (or its filter doesn't take the message). A dead-letter queue keeps it to inspect and replay.";
      // A route that takes only some types: let it take every failed message (a second route would never be used).
      const route = gap.route;
      const what = route
        ? `${name}'s dead-letter route doesn't take ${gap.missed.length ? listNames(gap.missed.map((t) => `“${t}”`)) : "any message"}`
        : `${name} has no dead-letter queue`;
      // A route whose id another element shares can't be updated by id (edit ops would change that element).
      const fix: CheckFix | undefined = !route
        ? addDeadLetterQueue(ctx, broker)
        : ctx.edgeRef(route.id)
          ? {
              label: `Send every failed message to ${ctx.name(route.to)}`,
              ops: [{ op: "update", target: route.id, props: { filter: null } }],
            }
          : undefined;
      if (failing.length) {
        const first = failing[0];
        out.push({
          id: `dead-letter:${id}`,
          rule: "dead-letter",
          severity: "warning",
          target: id,
          elements: [id, ...failing.map((f) => f.id), ...(route ? [route.id] : [])],
          title: "Failed messages are dropped",
          message: `${ctx.name(first.id)} ${first.why}${failing.length > 1 ? ` (and ${failing.length - 1} more consumer${failing.length > 2 ? "s" : ""} can fail)` : ""}, and ${what}: messages that run out of deliveries (${deliveries}) are lost.`,
          rationale,
          ...(fix ? { fix } : {}),
        });
      } else if (ctx.role(id) === "queue") {
        out.push({
          id: `dead-letter:${id}`,
          rule: "dead-letter",
          severity: "suggestion",
          target: id,
          elements: [id, ...consumers, ...(route ? [route.id] : [])],
          title: route ? `Some failed messages in ${name} are dropped` : `${name} has no dead-letter queue`,
          message: `If ${listNames(consumers.map(ctx.name))} can't handle a message, it's dropped after ${deliveries} deliveries${route ? `: ${what}` : ""}. A command queue is where losing messages hurts most.`,
          rationale,
          ...(fix ? { fix } : {}),
        });
      }
    }
    return out;
  },
};
