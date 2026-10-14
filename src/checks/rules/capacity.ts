import type { DiagramOp } from "../../ai";
import type { NodeCapacity } from "../../sim/capacity";
import { MAX_COUNT, sizingFix } from "../../sim/capacityPlanning";
import { formatRate, isBroker, type CheckContext } from "../context";
import {
  activeUnits,
  DEFAULT_MESSAGE_KB,
  deviceSpec,
  messagesPerSec,
  presetOf,
  SIZE_LABEL,
  sizeOf,
  sizesOf,
} from "../../stencils/netDevices";
import { FIX_TARGET } from "../../sim/capacityPlanning";
import type { CheckFix, CheckRule } from "../types";

// 7. capacity: the busiest processor or broker can't keep up at the diagram's own (free-play) rates: the
// same analysis as live view's Show capacity, without going live. Saved simulations aren't checked: most
// overload something on purpose, to tell a story, and live view's heat map is the place for those.
// Gateways and stores are left out: their capacity is a single-lane planning estimate. Planning and the fix
// are live view's own (src/sim/capacityPlanning.ts).

const DEFAULT_RATE = 2;

/** Live view's capacity fix (src/sim/capacityPlanning.ts) for this one node, as edit ops. */
function scaleFix(ctx: CheckContext, n: NodeCapacity): CheckFix | undefined {
  // Edit ops take replicas and partitions up to 10,000 (the op schema's bound).
  const changes = sizingFix(ctx.diagram, ctx.planning(), [n], {
    idle: n.idleReplicas > 0 ? n.id : undefined,
    maxCount: MAX_COUNT,
  });
  if (!changes) return undefined;
  const ops: DiagramOp[] = changes.map((c) => ({ op: "update", target: c.nodeId, props: { [c.key]: c.to } }));
  const words = changes.map((c) =>
    c.key === "replicas" ? `replicas to ${c.to}` : `${ctx.name(c.nodeId)} partitions to ${c.to}`,
  );
  return { label: `Set ${words.join(" and ")}`, ops };
}

/**
 * A network device's fix: the smallest bigger size whose preset carries the load at FIX_TARGET, with the throughput
 * and latency typed over the old size cleared so the preset shows through.
 */
function deviceFix(ctx: CheckContext, n: NodeCapacity): CheckFix | undefined {
  const node = ctx.nodes.get(n.id);
  const spec = deviceSpec(node?.stencil);
  if (!node || !spec) return undefined;
  const props = node.props ?? {};
  const sizes = sizesOf(spec);
  const now = sizes.indexOf(sizeOf(spec, props.size));
  const kb = typeof props.messageKB === "number" && props.messageKB > 0 ? props.messageKB : DEFAULT_MESSAGE_KB;
  const ha = props.ha === "active-standby" || props.ha === "active-active" ? props.ha : "standalone";
  const units = activeUnits(ha, Math.max(1, n.replicas));
  const size = sizes
    .slice(now + 1)
    .find((s) => messagesPerSec(presetOf(spec, s).gbps, kb) * units * FIX_TARGET >= n.offered);
  if (!size) return undefined;
  return {
    label: `Use the ${SIZE_LABEL[size].toLowerCase()} size (${presetOf(spec, size).model})`,
    ops: [{ op: "update", target: n.id, props: { size, gbps: null, latencyMs: null } }],
  };
}

export const capacity: CheckRule = {
  id: "capacity",
  name: "Can't keep up",
  about:
    "A service or broker over 100% at the diagram's own rates has a backlog that only grows. " +
    "Uses Show capacity's analysis at free-play rates (each source's rate), and reports the busiest service or broker.",
  detect(ctx) {
    const analysis = ctx.capacity();
    const order = new Map(ctx.diagram.nodes.map((n, i) => [n.id, i]));
    const candidates = Object.values(analysis.nodes)
      .filter(
        (n) =>
          n.offered > 0 &&
          n.utilization >= 1 &&
          (n.role === "processor" || !!n.device || (isBroker(ctx, n.id) && ctx.routes(n.id).length > 0)),
      )
      .sort(
        (a, b) =>
          (b.utilization === a.utilization ? 0 : b.utilization > a.utilization ? 1 : -1) ||
          Number(b.role === "processor") - Number(a.role === "processor") ||
          order.get(a.id)! - order.get(b.id)!,
      );
    const top = candidates[0];
    if (!top) return [];
    const sources = ctx.diagram.nodes.filter((n) => ctx.role(n.id) === "source");
    const unset = sources.filter((n) => typeof n.props?.ratePerSec !== "number");
    const rates = unset.length
      ? `the diagram's own rates (${unset.length === sources.length ? "" : "sources without a rate send "}${formatRate(DEFAULT_RATE)}${unset.length === sources.length ? " per source" : ""})`
      : "the diagram's own rates";
    const name = ctx.name(top.id);
    const finite = Number.isFinite(top.utilization);
    const load = finite
      ? `it gets ${formatRate(top.offered)} and handles ${formatRate(top.capacity)} (${Math.round(top.utilization * 100)}%)`
      : `it gets ${formatRate(top.offered)} and can't handle any`;
    const idle =
      top.idleReplicas > 0
        ? ` ${top.idleReplicas} of its ${top.replicas} replicas sit idle: a consumer group can't use more consumers than partitions.`
        : "";
    const fix = top.device ? deviceFix(ctx, top) : scaleFix(ctx, top);
    return [
      {
        id: `capacity:${top.id}`,
        rule: "capacity",
        severity: "warning",
        target: top.id,
        elements: [top.id],
        title: `${name} can't keep up`,
        message: `At ${rates}, ${load}: its backlog only grows.${idle}${analysis.converged ? "" : " A feedback loop didn't settle, so these are estimates."}`,
        rationale:
          "Demand above what a service can handle never drains: latency and backlog grow until something times out. Live view's Show capacity has the same numbers.",
        ...(fix ? { fix } : {}),
      },
    ];
  },
};
