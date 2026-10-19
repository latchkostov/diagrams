import type { DiagramFile, Simulation } from "../model/types";
import { analyzeCapacity, type CapacityAnalysis } from "../sim/capacity";
import { planningSimulation, sourceTraffic, sizingFix, type SizingChange } from "../sim/capacityPlanning";
import { compileTopology, brokerRole, type CompiledTopology } from "../sim/topology";
import { stencilRole } from "../stencils/roles";
import { resolveMultiplier } from "../sim/units";
import type { RealNodeMetrics, NodeStatus } from "../sim/types";

export const explanationSimulation = (d: DiagramFile): Simulation => ({
  id: "free-play",
  title: "Free play",
  traffic: sourceTraffic(d),
});
export interface Explanation {
  waits?: import("../sim/capacity").NodeCapacity["waits"];
  resources?: import("../sim/resourcePlanning").ResourcePlan;
  managed?: "serverless" | "api";
  status: NodeStatus;
  role: string;
  id: string;
  reason: "capacity" | "no-reader" | "throughput";
  evidence: "configured";
  unit: "req/s" | "msg/s";
  capacity: number;
  offered: number;
  replicas: number;
  baseReplicas: number;
  omittedContributors: number;
  activeReplicas: number;
  assignments: { broker: string; spec: import("../model/brokers").BrokerSpec; count: number }[];
  slots: number;
  seconds: number;
  utilization: number;
  growth: number;
  contributors: { edge: string; node: string; label: string; via?: string; rate: number }[];
  target: number;
  /** Base counts (before the capacity multiplier). */
  minimumReplicas?: number;
  targetReplicas?: number;
  changes: SizingChange[] | null;
  fixId?: string;
  addConsumer?: string;
  converged: boolean;
  /** Request routing: configured demand by route here (most first, at most eight) and what the table refuses. */
  routes?: { route: string; address: string; offered: number; rejected: number; throttled: number }[];
  observed?: { throughput: number; waiting: number; processed: number; inFlight: number };
}

/** Numbers are real once. Observed inputs are tagged RealNodeMetrics; never multiplied by dot scale here. */
export function explainNode(
  d: DiagramFile,
  id: string,
  options: {
    sim?: Simulation;
    analysis?: CapacityAnalysis;
    topology?: CompiledTopology;
    target?: number;
    /** Descriptions need arithmetic, not graph-wide verification of an actionable fix. */
    fixes?: boolean;
    observed?: RealNodeMetrics;
  } = {},
): Explanation | undefined {
  const sim = options.sim ?? explanationSimulation(d);
  const analysis = options.analysis ?? analyzeCapacity(d, planningSimulation(d, sim));
  const topology = options.topology ?? compileTopology(d);
  const node = d.nodes.find((n) => n.id === id);
  const n = analysis.nodes[id];
  if (!node || !n || (n.role !== "processor" && !brokerRole(n.role) && !n.device && !n.managed)) return undefined;
  const index = explanationIndex(d, topology);
  const incoming = index.incoming.get(id) ?? [];
  const peers = new Map<string, { edge: string; node: string; label: string; via?: string; rate: number }>();
  let omittedContributors = 0,
    textRemaining = MAX_CONTRIBUTOR_TEXT;
  for (const e of incoming) {
    const rate = analysis.connections[e.id] ?? 0;
    if (rate <= 0) continue;
    const existing = peers.get(e.from);
    if (existing) {
      existing.rate += rate;
      continue;
    }
    const source = index.nodes.get(e.from)!;
    peers.set(e.from, { edge: e.id, node: source.id, label: "", rate });
  }
  omittedContributors += Math.max(0, peers.size - MAX_CONTRIBUTORS);
  const contributors = [...peers.values()].slice(0, MAX_CONTRIBUTORS).map((c) => {
    const source = index.nodes.get(c.node)!;
    const upstream = index.upstream.get(c.node);
    const names = upstream?.labels ?? source.label;
    omittedContributors += upstream?.omitted ?? 0;
    const label = names.slice(0, Math.min(256, textRemaining));
    textRemaining -= label.length;
    const via = upstream ? source.label.slice(0, Math.min(64, textRemaining)) : undefined;
    textRemaining -= via?.length ?? 0;
    return { ...c, label, ...(via !== undefined ? { via } : {}) };
  });
  const noReader = brokerRole(n.role) && !(topology.outgoing.get(id) ?? []).some((e) => !e.deny);
  if (brokerRole(n.role) && !noReader) return undefined;
  const target = options.target ?? 0.5;
  const changes =
    !noReader && analysis.converged && options.fixes !== false
      ? sizingFix(d, sim, [n], {
          target,
          idle: n.idleReplicas ? id : undefined,
          status: Object.fromEntries(Object.entries(analysis.nodes).map(([id, n]) => [id, n.status])),
        })
      : null;
  const props = analysis.resolved[id];
  const baseNeeded = (target: number) =>
    Math.max(
      props.replicas,
      Math.ceil(
        Math.max(n.replicas, Math.ceil((n.activeReplicas * n.utilization) / target)) /
          Math.max(resolveMultiplier(sim.multipliers?.capacity), 1e-9),
      ),
    );
  const min =
    !n.managed && !n.resourcePlan?.max && n.role === "processor" && Number.isFinite(n.utilization) && n.capacity
      ? baseNeeded(1)
      : undefined;
  const chosen = changes?.find((c) => c.nodeId === id && c.key === "replicas");
  const targetReplicas =
    chosen?.key === "replicas"
      ? chosen.to
      : options.fixes === false && min !== undefined
        ? baseNeeded(target)
        : undefined;
  return {
    ...(n.managed
      ? { managed: props.profile.family === "serverless" ? ("serverless" as const) : ("api" as const) }
      : {}),
    resources: n.resourcePlan,
    ...(n.waits ? { waits: n.waits } : {}),
    id,
    role: n.role,
    status: n.status ?? "up",
    reason: noReader ? "no-reader" : n.utilization >= 1 ? "capacity" : "throughput",
    evidence: "configured",
    unit: incoming.length && incoming.every((e) => e.sync) ? "req/s" : "msg/s",
    capacity: n.capacity,
    offered: n.offered,
    replicas: n.replicas,
    baseReplicas: props.replicas,
    omittedContributors,
    activeReplicas: n.activeReplicas,
    assignments: [...new Set(incoming.map((e) => e.from))].flatMap((broker) => {
      const spec = analysis.resolved[broker].broker;
      return spec?.partitioned ? [{ broker, spec, count: analysis.resolved[broker].partitions }] : [];
    }),
    slots: props.concurrency,
    seconds: (n.waits?.threadHoldMs ?? props.latencyMs) / 1000,
    utilization: n.utilization,
    growth: Math.max(0, n.offered - n.capacity),
    contributors,
    target,
    ...(min !== undefined ? { minimumReplicas: min } : {}),
    ...(targetReplicas !== undefined ? { targetReplicas } : {}),
    changes,
    ...(noReader ? { addConsumer: id, fixId: `no-reader:${id}` } : changes ? { fixId: `capacity:${id}` } : {}),
    converged: analysis.converged,
    ...routeLines(d, analysis, id),
    ...(options.observed
      ? {
          observed: {
            throughput: options.observed.throughput,
            waiting: options.observed.backlog,
            processed: options.observed.processed,
            inFlight: options.observed.inFlight,
          },
        }
      : {}),
  };
}

export const MAX_CONTRIBUTORS = 24;
export const MAX_CONTRIBUTOR_TEXT = 2048;
const indexes = new WeakMap<CompiledTopology, ReturnType<typeof buildExplanationIndex>>();
function explanationIndex(d: DiagramFile, topology: CompiledTopology) {
  let index = indexes.get(topology);
  if (!index) {
    index = buildExplanationIndex(d, topology);
    indexes.set(topology, index);
  }
  return index;
}
function buildExplanationIndex(d: DiagramFile, topology: CompiledTopology) {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, CompiledTopology["edges"]>();
  for (const edge of topology.edges) {
    if (edge.deny || edge.dlq) continue;
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }
  const upstream = new Map<string, { labels: string; omitted: number }>();
  for (const [id, edges] of incoming) {
    const node = nodes.get(id)!;
    if (stencilRole(node.stencil) !== "gateway") continue;
    const peers = [...new Set(edges.map((e) => e.from))];
    upstream.set(id, {
      labels: peers
        .slice(0, 8)
        .map((id) => nodes.get(id)!.label.slice(0, 24))
        .join(", "),
      omitted: Math.max(0, peers.length - 8),
    });
  }
  return { nodes, incoming, upstream };
}

/** A node's configured demand by request route ("" for requests without an address), for its explanation. */
function routeLines(d: DiagramFile, analysis: CapacityAnalysis, id: string): Pick<Explanation, "routes"> {
  const byRoute = analysis.routeDemand?.[id];
  if (!byRoute) return {};
  const routes = new Map((d.planning?.requestRoutes ?? []).map((r) => [r.id, r]));
  const lines = Object.entries(byRoute)
    .filter(([, demand]) => demand.offered > 0)
    .map(([route, demand]) => {
      const r = routes.get(route);
      return { route, address: r ? `${r.address.method} ${r.address.path}` : "", ...demand };
    })
    .sort((a, b) => b.offered - a.offered || a.route.localeCompare(b.route))
    .slice(0, 8);
  return lines.length ? { routes: lines } : {};
}
