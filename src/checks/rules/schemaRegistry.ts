import type { DiagramOp } from "../../ai";
import type { DiagramNode } from "../../model/types";
import { MAX_BATCH, fitsRef, isBroker, listNames, sharedBoundary } from "../context";
import { isKafkaFamily } from "../kinds";
import type { CheckFix, CheckRule } from "../types";

// 10. schema-registry: Avro or Protobuf on Kafka with no schema registry in the diagram. Confluent's serializers
// write a registry's schema id in front of every record, so a consumer can't decode one without the registry, and
// it's the registry that refuses a producer's incompatible schema change. A topic says its format in
// `props.contentType` (the AsyncAPI import writes it from the message's content type or schema format) or in its
// label. One Warning per diagram: a registry serves every topic. A registry drawn any way (Confluent's stencil, or a
// node named as one: Apicurio, Glue Schema Registry) keeps it quiet. The fix adds Schema Registry with a Depends on
// dependency from each producer and consumer of those topics: it only adds, and a dependency carries no traffic.

const FORMAT = /\b(avro|protobuf)\b/i;
const REGISTRY = /schema[\s-]?registry|apicurio/i;
/** Words saying there isn't one: "no schema registry", "needs a schema registry", "schema registry: missing". */
const MISSING =
  /\b(no|not|without|lacks?|needs?|todo)\W+(\w+\W+){0,3}?(schema[\s-]?registry|apicurio)|(schema[\s-]?registry|apicurio)\W+(\w+\W+){0,2}?(missing|needed|planned|todo)\b/i;
const NAMES: Record<string, string> = { avro: "Avro", protobuf: "Protobuf" };

/** The topic's schema format, from its content type, else its words. */
function formatOf(node: DiagramNode): string | undefined {
  const type = node.props?.contentType;
  const match =
    (typeof type === "string" ? FORMAT.exec(type) : null) ?? FORMAT.exec(`${node.label} ${node.sublabel ?? ""}`);
  return match ? NAMES[match[1].toLowerCase()] : undefined;
}

export const schemaRegistry: CheckRule = {
  id: "schema-registry",
  name: "Avro or Protobuf without a schema registry",
  about:
    "Kafka's Avro and Protobuf serializers put a schema id from a registry in every record: without one, consumers can't decode them and nothing stops an incompatible schema change. " +
    "Fires once per diagram, for Kafka topics whose content type or label says Avro or Protobuf when no schema registry is drawn.",
  detect(ctx) {
    const nodes = ctx.diagram.nodes;
    // A registry: the stencil, or a node (not a broker: a topic is never one) named as one, not as missing.
    const named = (n: DiagramNode) => {
      const words = `${n.label} ${n.sublabel ?? ""}`;
      return !isBroker(ctx, n.id) && REGISTRY.test(words) && !MISSING.test(words);
    };
    if (nodes.some((n) => n.stencil === "kafka.schema-registry" || named(n))) return [];
    const topics = nodes.flatMap((n) => {
      const format = isKafkaFamily(n.stencil) ? formatOf(n) : undefined;
      return format ? [{ id: n.id, format }] : [];
    });
    if (!topics.length) return [];
    // Who writes and reads them, writers first: every Kafka client of these topics needs the registry.
    const producers = new Set<string>();
    const consumers = new Set<string>();
    for (const { id } of topics) {
      for (const e of ctx.incoming(id)) if (!isBroker(ctx, e.from)) producers.add(e.from);
      for (const e of ctx.routes(id)) if (!isBroker(ctx, e.to)) consumers.add(e.to);
    }
    const clients = [...new Set([...producers, ...consumers])];
    const formats = [...new Set(topics.map((t) => t.format))];
    const format = formats.join(" and ");
    const first = ctx.name(topics[0].id);
    const where =
      topics.length === 1 ? first : `${first} and ${topics.length - 1} more topic${topics.length > 2 ? "s" : ""}`;

    const key = ctx.freshKey("new-schema-registry");
    // Beside the topics, in their boundary (a Kafka cluster's) when they share one.
    const boundary = sharedBoundary(
      ctx,
      topics.map((t) => t.id),
    );
    const ops: DiagramOp[] = [
      {
        op: "add_node",
        kind: "kafka.schema-registry",
        label: "Schema Registry",
        sublabel: "schemas",
        key,
        ...(boundary ? { in: boundary } : {}),
      },
      ...clients.map((from): DiagramOp => ({ op: "connect", from, to: key, relation: "depends" })),
    ];
    // Only while it fits the operation schema: one edit batch, and ids short enough to name.
    const safe = clients.every(fitsRef);
    const fix: CheckFix | undefined =
      safe && ops.length <= MAX_BATCH ? { label: "Add Schema Registry", ops } : undefined;
    const who = [
      producers.size ? `${listNames([...producers].map(ctx.name))} write${producers.size === 1 ? "s" : ""} it` : "",
      consumers.size ? `${listNames([...consumers].map(ctx.name))} read${consumers.size === 1 ? "s" : ""} it` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    return [
      {
        id: `schema-registry:${topics[0].id}`,
        rule: "schema-registry",
        severity: "warning",
        target: topics[0].id,
        elements: [...topics.map((t) => t.id), ...clients],
        title: `${format} on ${where}, but no schema registry`,
        message:
          `${where} carr${topics.length === 1 ? "ies" : "y"} ${format}${who ? `; ${who}` : ""}. With no schema registry, consumers can't look up the schema a record was written with, and nothing checks that a new one is compatible.` +
          (fix ? "" : " That's too big a change for one step (an edit batch): add the registry by hand."),
        rationale:
          "Kafka's Avro and Protobuf serializers write a schema id from the registry in front of every record, and the registry refuses a schema change that would break its readers. Without it, producers and consumers have to agree on schemas some other way.",
        ...(fix ? { fix } : {}),
      },
    ];
  },
};
