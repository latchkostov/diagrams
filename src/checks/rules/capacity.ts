import type { DiagramOp } from "../../ai";
import type { DiagramFile } from "../../model/types";
import { analyzeCapacity, type NodeCapacity } from "../../sim/capacity";
import { resolveProps } from "../../sim/defaults";
import { allocateGroupReplicas, brokerRole } from "../../sim/topology";
import { formatRate, isBroker, type CheckContext } from "../context";
import type { CheckFix, CheckRule } from "../types";

// 7. capacity: the busiest processor or broker can't keep up at the diagram's own (free-play) rates: the
// same analysis as live view's Show capacity, without going live. Saved simulations aren't checked: most
// overload something on purpose, to tell a story, and live view's heat map is the place for those.
// Gateways and stores are left out: their capacity is a single-lane planning estimate.

/** Like live view's capacity fix: aim for this much utilization after the change. */
const TARGET = 0.55;
/** Edit ops take replicas and partitions up to this. */
const MAX_COUNT = 10_000;
const DEFAULT_RATE = 2;

/** Partitions on `brokerId` so every member of its groups that includes `id` gets `replicas` consumers. */
function partitionsFor(ctx: CheckContext, brokerId: string, id: string, replicas: number): number | undefined {
  const broker = ctx.nodes.get(brokerId)!;
  const role = ctx.role(brokerId);
  const from = resolveProps(role, broker.label, broker.props ?? {}).partitions;
  let need = from;
  for (const group of ctx.topology.groups.get(brokerId) ?? []) {
    if (!group.members.includes(id)) continue;
    const members = group.members.map((m) => ({
      id: m,
      role: ctx.role(m),
      replicas: m === id ? replicas : (ctx.capacity().nodes[m]?.replicas ?? 1),
    }));
    const enough = (p: number) => (allocateGroupReplicas(role, p, members).get(id) ?? 0) >= replicas;
    let high = Math.max(from, 1);
    while (high < MAX_COUNT && !enough(high)) high = Math.min(MAX_COUNT, high * 2);
    if (!enough(high)) return undefined;
    let low = from;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (enough(mid)) high = mid;
      else low = mid + 1;
    }
    need = Math.max(need, high);
  }
  return need;
}

/** Raise the processor's replicas (and its topic's partitions, when they'd sit idle), checked by analysis. */
function scaleFix(ctx: CheckContext, n: NodeCapacity): CheckFix | undefined {
  if (n.role !== "processor" || !Number.isFinite(n.utilization) || !n.capacity) return undefined;
  const active = Math.max(1, n.activeReplicas);
  const replicas = Math.min(
    MAX_COUNT,
    Math.max(n.replicas + (n.idleReplicas ? 0 : 1), Math.ceil((active * n.utilization) / TARGET)),
  );
  const changes: { id: string; key: "replicas" | "partitions"; to: number }[] = [];
  if (replicas > n.replicas) changes.push({ id: n.id, key: "replicas", to: replicas });
  // A consumer reached only through topics or streams gets at most one replica per partition.
  for (const [brokerId] of ctx.topology.restricted.has(n.id) ? ctx.topology.groups : []) {
    if (!brokerRole(ctx.role(brokerId)) || ctx.role(brokerId) === "queue") continue;
    if (!ctx.routes(brokerId).some((e) => e.to === n.id)) continue;
    const broker = ctx.nodes.get(brokerId)!;
    const from = resolveProps(ctx.role(brokerId), broker.label, broker.props ?? {}).partitions;
    const to = partitionsFor(ctx, brokerId, n.id, replicas);
    if (to === undefined) return undefined;
    if (to > from) changes.push({ id: brokerId, key: "partitions", to });
  }
  if (!changes.length) return undefined;
  // Only offer what fixes it: the same analysis, after the change.
  const planned = ctx.planning();
  const after: DiagramFile = {
    ...planned,
    nodes: planned.nodes.map((node) => {
      const mine = changes.filter((c) => c.id === node.id);
      return mine.length
        ? { ...node, props: { ...node.props, ...Object.fromEntries(mine.map((c) => [c.key, c.to])) } }
        : node;
    }),
  };
  if (!(analyzeCapacity(after).nodes[n.id].utilization < 1)) return undefined;
  const ops: DiagramOp[] = changes.map((c) => ({ op: "update", target: c.id, props: { [c.key]: c.to } }));
  const words = changes.map((c) =>
    c.key === "replicas" ? `replicas to ${c.to}` : `${ctx.name(c.id)} partitions to ${c.to}`,
  );
  return { label: `Set ${words.join(" and ")}`, ops };
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
          (n.role === "processor" || (isBroker(ctx, n.id) && ctx.routes(n.id).length > 0)),
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
    const fix = scaleFix(ctx, top);
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
