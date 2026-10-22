import { revisionAtLeast } from "../model/revisions";
import { englishAssignmentLabel } from "../model/brokers";
import { resolveNodeProps } from "../sim/defaults";
import type { DiagramOp } from "../ai";
import type { NodeCapacity } from "../sim/capacity";
import { MAX_COUNT, sizingFix } from "../sim/capacityPlanning";
import type { CheckContext } from "./context";
import { SIZE_LABEL } from "../stencils/netDevices";

import type { CheckFix } from "./types";

/** Live view's capacity fix (src/sim/capacityPlanning.ts) for this one node, as edit ops. */
export function scaleFix(ctx: CheckContext, n: NodeCapacity, fixed = false): CheckFix | undefined {
  // Edit ops take replicas and partitions up to 10,000 (the op schema's bound).
  const diagram = fixed
    ? {
        ...ctx.diagram,
        nodes: ctx.diagram.nodes.map((node) =>
          node.id === n.id ? { ...node, props: { ...node.props, autoscaling: { mode: "off" } } } : node,
        ),
      }
    : ctx.diagram;
  const changes = sizingFix(diagram, ctx.planning(), [n], {
    idle: n.idleReplicas > 0 ? n.id : undefined,
    maxCount: MAX_COUNT,
  });
  if (!changes) return undefined;
  const ops: DiagramOp[] = changes.map((c) => ({ op: "update", target: c.nodeId, props: { [c.key]: c.to } }));
  if (fixed) {
    const op = ops.find((o) => o.op === "update" && o.target === n.id);
    if (op?.op === "update") op.props = { ...op.props, autoscaling: { mode: "off" } };
  }
  // A device's next size (and the throughput typed over its old one) is one change: say it as the size.
  const size = changes.find((c) => c.key === "size");
  if (size) return { label: `Use the ${SIZE_LABEL[size.to].toLowerCase()} size (${size.model})`, ops };
  const brokerChanges: NonNullable<CheckFix["brokerChanges"]> = [];
  const words = changes.map((c) => {
    const spec =
      c.key === "partitions" && revisionAtLeast(ctx.diagram.planning?.revision, "p2")
        ? resolveNodeProps(ctx.diagram, ctx.nodes.get(c.nodeId)!).broker
        : undefined;
    if (spec) {
      const name = ctx.name(c.nodeId);
      const text = `${name}: ${englishAssignmentLabel(spec)} → ${c.to}`;
      brokerChanges.push({ text, name, spec, count: c.to as number });
      return text;
    }
    return c.key === "replicas" ? `replicas to ${c.to}` : `${ctx.name(c.nodeId)} partitions to ${c.to}`;
  });
  return { label: `Set ${words.join(" and ")}`, ops, ...(brokerChanges.length ? { brokerChanges } : {}) };
}
