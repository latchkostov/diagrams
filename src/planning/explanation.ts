import type { DiagramFile, Simulation } from "../model/types";
import { analyzeCapacity, type CapacityAnalysis } from "../sim/capacity";
import { planningSimulation, sourceTraffic, sizingFix, type SizingChange } from "../sim/capacityPlanning";
import { compileTopology, brokerRole, type CompiledTopology } from "../sim/topology";
import { stencilRole } from "../stencils/roles";
import type { RealNodeMetrics, NodeStatus } from "../sim/types";

export const explanationSimulation = (d: DiagramFile): Simulation => ({
  id: "free-play",
  title: "Free play",
  traffic: sourceTraffic(d),
});
export interface Explanation {
  status: NodeStatus;
  role: string;
  id: string;
  reason: "capacity" | "no-reader" | "throughput";
  evidence: "configured";
  unit: "req/s" | "msg/s";
  capacity: number;
  offered: number;
  replicas: number;
  activeReplicas: number;
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
    observed?: RealNodeMetrics;
  } = {},
): Explanation | undefined {
  const sim = options.sim ?? explanationSimulation(d);
  const analysis = options.analysis ?? analyzeCapacity(d, planningSimulation(d, sim));
  const topology = options.topology ?? compileTopology(d);
  const node = d.nodes.find((n) => n.id === id);
  const n = analysis.nodes[id];
  if (!node || !n || (n.role !== "processor" && !brokerRole(n.role) && !n.device)) return undefined;
  const incoming = topology.edges.filter((e) => e.to === id && !e.deny && !e.dlq);
  const labels = new Map(d.nodes.map((n) => [n.id, n.label]));
  const contributors = incoming
    .map((e) => {
      const source = d.nodes.find((n) => n.id === e.from)!;
      // Transparent routing hops identify who sends the traffic without claiming downstream request semantics.
      const upstream =
        stencilRole(source.stencil) === "gateway"
          ? topology.edges.filter((i) => i.to === source.id && !i.deny && !i.dlq)
          : [];
      return {
        edge: e.id,
        node: source.id,
        label: upstream.length ? upstream.map((i) => labels.get(i.from)!).join(", ") : source.label,
        ...(upstream.length ? { via: source.label } : {}),
        rate: analysis.connections[e.id] ?? 0,
      };
    })
    .filter((c) => c.rate > 0);
  const noReader = brokerRole(n.role) && !(topology.outgoing.get(id) ?? []).some((e) => !e.deny);
  if (brokerRole(n.role) && !noReader) return undefined;
  const target = options.target ?? 0.5;
  const changes =
    !noReader && analysis.converged ? sizingFix(d, sim, [n], { target, idle: n.idleReplicas ? id : undefined }) : null;
  const minimum =
    !noReader && analysis.converged
      ? sizingFix(d, sim, [n], { target: 1, idle: n.idleReplicas ? id : undefined })
      : null;
  const props = analysis.resolved[id];
  const count = (list: SizingChange[] | null) => list?.find((c) => c.nodeId === id && c.key === "replicas");
  const min = count(minimum),
    chosen = count(changes);
  return {
    id,
    role: n.role,
    status: n.status ?? "up",
    reason: noReader ? "no-reader" : n.utilization >= 1 ? "capacity" : "throughput",
    evidence: "configured",
    unit: incoming.length && incoming.every((e) => e.sync) ? "req/s" : "msg/s",
    capacity: n.capacity,
    offered: n.offered,
    replicas: n.replicas,
    activeReplicas: n.activeReplicas,
    slots: props.concurrency,
    seconds: props.latencyMs / 1000,
    utilization: n.utilization,
    growth: Math.max(0, n.offered - n.capacity),
    contributors,
    target,
    ...(min?.key === "replicas" ? { minimumReplicas: min.to } : {}),
    ...(chosen?.key === "replicas" ? { targetReplicas: chosen.to } : {}),
    changes,
    ...(noReader ? { addConsumer: id, fixId: `no-reader:${id}` } : changes ? { fixId: `capacity:${id}` } : {}),
    converged: analysis.converged,
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
