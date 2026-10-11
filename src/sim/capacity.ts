import type { DiagramEdge, DiagramFile, DiagramNode, SimRole, Simulation } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { resolveProps, type ResolvedProps } from "./defaults";
import { peakRate } from "./scale";
import { acceptsType, allocateReplicas, brokerRole, emittedType, isDlqEdge } from "./topology";
import { resolveMultiplier } from "./units";

export interface NodeCapacity {
  id: string;
  label: string;
  role: SimRole;
  /** All rates are real messages/s. Infinity means no modeled service limit. */
  capacity: number;
  offered: number;
  utilization: number;
  replicas: number;
  activeReplicas: number;
  idleReplicas: number;
}
export interface CapacityAnalysis {
  nodes: Record<string, NodeCapacity>;
  bottleneck?: NodeCapacity;
  suggestion: string;
  /** False for an amplifying/unbounded cycle or when the iteration/rate cap is reached. */
  converged: boolean;
  iterations: number;
}
interface Entry {
  input: DiagramNode;
  role: SimRole;
  props: ResolvedProps;
  replicas: number;
  active: number;
  up: boolean;
}
interface ConsumerGroup {
  broker: Entry;
  edges: DiagramEdge[];
  allocations: Map<string, number>;
}
type Rates = Map<string, Map<string, number>>;
const RATE_CAP = 1e12;
const ITERATION_CAP = 256;
const serviceRate = (entry: Entry, replicas = entry.active): number => {
  if (!entry.up) return 0;
  if (entry.role === "processor") {
    const slots = replicas * entry.props.concurrency;
    return !slots ? 0 : entry.props.latencyMs ? (slots * 1000) / entry.props.latencyMs : Infinity;
  }
  if (entry.role === "gateway" || entry.role === "store")
    return entry.props.latencyMs ? 1000 / entry.props.latencyMs : Infinity;
  return Infinity;
};
const total = (rates: Map<string, number> | undefined) =>
  [...(rates?.values() ?? [])].reduce((sum, rate) => sum + rate, 0);
const ratio = (offered: number, capacity: number) =>
  capacity === 0 ? (offered > 0 ? Infinity : 0) : offered / capacity;

/** Nominal peak-demand planning: setup and multipliers apply; timeline chaos/retries/travel are excluded.
 * Demand is not clipped at upstream capacity, so downstream overloads remain visible. */
export function analyzeCapacity(diagram: DiagramFile, simulation?: Simulation): CapacityAnalysis {
  const trafficMultiplier = resolveMultiplier(simulation?.multipliers?.traffic);
  const capacityMultiplier = resolveMultiplier(simulation?.multipliers?.capacity);
  const entries = new Map<string, Entry>();
  for (const input of diagram.nodes) {
    const role = stencilRole(input.stencil);
    const raw = { ...input.props, ...simulation?.setup?.props?.[input.id] };
    const props = resolveProps(role, input.label, raw);
    const replicas = Math.max(1, Math.round(props.replicas * capacityMultiplier));
    const status = simulation?.setup?.status?.[input.id] ?? raw.status;
    entries.set(input.id, {
      input,
      role,
      props,
      replicas,
      active: replicas,
      up: status !== "down" && status !== "paused",
    });
  }
  const ids = new Set<string>();
  const edges = diagram.edges.filter((edge) => {
    const from = entries.get(edge.from),
      to = entries.get(edge.to);
    if (!from || !to || ids.has(edge.id)) return false;
    ids.add(edge.id);
    return !isDlqEdge(edge, from.role, to.input, to.role);
  });
  const outgoing = new Map<string, DiagramEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const groups = new Map<string, ConsumerGroup[]>();
  const restricted = new Set<string>(),
    unrestricted = new Set<string>();
  const assigned = new Map<string, number>();
  for (const edge of edges) {
    const from = entries.get(edge.from)!;
    if (from.role === "topic" || from.role === "stream") restricted.add(edge.to);
    else unrestricted.add(edge.to);
  }
  for (const entry of entries.values()) {
    if (!brokerRole(entry.role)) continue;
    const named = new Map<string, DiagramEdge[]>();
    for (const edge of outgoing.get(entry.input.id) ?? []) {
      const name =
        entry.role === "queue" ? "queue" : typeof edge.props?.group === "string" ? edge.props.group : edge.id;
      const list = named.get(name) ?? [];
      list.push(edge);
      named.set(name, list);
    }
    const consumerGroups = [...named.values()].map((groupEdges) => {
      const members = groupEdges.map((edge) => ({
        id: edge.to,
        replicas: entries.get(edge.to)!.role === "processor" ? entries.get(edge.to)!.replicas : entry.props.partitions,
      }));
      const allocations = allocateReplicas(
        members,
        entry.role === "queue" ? members.reduce((sum, member) => sum + member.replicas, 0) : entry.props.partitions,
      );
      for (const [id, count] of allocations) assigned.set(id, Math.max(assigned.get(id) ?? 0, count));
      return { broker: entry, edges: groupEdges, allocations };
    });
    groups.set(entry.input.id, consumerGroups);
  }
  for (const [id, entry] of entries) {
    if (restricted.has(id) && !unrestricted.has(id)) entry.active = Math.min(entry.replicas, assigned.get(id) ?? 0);
  }
  const external: Rates = new Map();
  let capped = false;
  function add(rates: Rates, id: string, type: string, value: number): void {
    if (!(value > 0)) return;
    const types = rates.get(id) ?? new Map<string, number>();
    const sum = (types.get(type) ?? 0) + value;
    if (sum > RATE_CAP) capped = true;
    types.set(type, Math.min(RATE_CAP, sum));
    rates.set(id, types);
  }
  if (simulation) {
    for (const profile of simulation.traffic) {
      const entry = entries.get(profile.node);
      if (entry)
        add(
          external,
          profile.node,
          profile.messageType ?? entry.props.messageType,
          peakRate(profile.shape) * trafficMultiplier,
        );
    }
  } else {
    for (const [id, entry] of entries)
      if (entry.role === "source") add(external, id, entry.props.messageType, entry.props.ratePerSec);
  }
  const groupRate = (group: ConsumerGroup, edge: DiagramEdge) => {
    const target = entries.get(edge.to)!;
    const allocated = group.allocations.get(edge.to) ?? 0;
    return allocated ? serviceRate(target, allocated) : 0;
  };
  function split(next: Rates, candidates: DiagramEdge[], type: string, rate: number, weights: number[]): void {
    const infinite = weights.filter((weight) => weight === Infinity).length;
    const sum = weights.reduce((value, weight) => value + (Number.isFinite(weight) ? weight : 0), 0);
    candidates.forEach((edge, index) => {
      const fraction = infinite ? (weights[index] === Infinity ? 1 / infinite : 0) : sum ? weights[index] / sum : 0;
      add(next, edge.to, emittedType(edge.props?.emits, type), rate * fraction);
    });
  }
  function propagate(next: Rates, entry: Entry, type: string, rate: number, injected: boolean): void {
    if (!rate) return;
    const id = entry.input.id;
    if (entry.role === "processor" || entry.role === "none") type = emittedType(entry.props.emits, type);
    const routes = (outgoing.get(id) ?? []).filter((edge) => acceptsType(edge.props?.filter, type));
    if (brokerRole(entry.role)) {
      for (const group of groups.get(id) ?? []) {
        const accepting = group.edges.filter((edge) => acceptsType(edge.props?.filter, type));
        split(
          next,
          accepting,
          type,
          rate,
          accepting.map(
            (edge) => groupRate(group, edge) / accepting.filter((candidate) => candidate.to === edge.to).length,
          ),
        );
      }
    } else if (entry.role === "gateway") {
      split(
        next,
        routes,
        type,
        rate,
        routes.map(() => 1),
      );
    } else {
      for (const edge of routes) {
        if (!injected && (entry.role === "sink" || (entry.role === "store" && edge.kind === "sync"))) continue;
        const share =
          typeof edge.props?.share === "number" && Number.isFinite(edge.props.share)
            ? Math.max(0, Math.min(1, edge.props.share))
            : 1;
        add(next, edge.to, emittedType(edge.props?.emits, type), rate * share);
      }
    }
  }
  let rates = external,
    converged = false,
    iterations = 0;
  for (; iterations < ITERATION_CAP; iterations++) {
    const next: Rates = new Map([...external].map(([id, types]) => [id, new Map(types)]));
    for (const [id, types] of rates) {
      const entry = entries.get(id)!;
      for (const [type, rate] of types) {
        const injection = external.get(id)?.get(type) ?? 0;
        propagate(next, entry, type, injection, true);
        propagate(next, entry, type, Math.max(0, rate - injection), false);
      }
    }
    let error = 0;
    for (const id of new Set([...rates.keys(), ...next.keys()])) {
      for (const type of new Set([...(rates.get(id)?.keys() ?? []), ...(next.get(id)?.keys() ?? [])]))
        error = Math.max(error, Math.abs((next.get(id)?.get(type) ?? 0) - (rates.get(id)?.get(type) ?? 0)));
    }
    rates = next;
    if (error < 1e-7 && !capped) {
      converged = true;
      iterations++;
      break;
    }
  }
  const nodes: Record<string, NodeCapacity> = Object.create(null);
  for (const [id, entry] of entries) {
    const offered = total(rates.get(id));
    let capacity = serviceRate(entry);
    if (brokerRole(entry.role)) {
      const limits = (groups.get(id) ?? []).map((group) => {
        const unique = [...new Map(group.edges.map((edge) => [edge.to, edge])).values()];
        const service = unique.reduce((sum, edge) => sum + groupRate(group, edge), 0);
        const accepted = [...(rates.get(id) ?? [])].reduce(
          (sum, [type, rate]) => sum + (group.edges.some((edge) => acceptsType(edge.props?.filter, type)) ? rate : 0),
          0,
        );
        return offered && !accepted ? Infinity : accepted ? (service * offered) / accepted : service;
      });
      capacity = !entry.up ? 0 : limits.length ? Math.min(...limits) : 0;
    }
    nodes[id] = {
      id,
      label: entry.input.label,
      role: entry.role,
      capacity,
      offered,
      utilization: ratio(offered, capacity),
      replicas: entry.replicas,
      activeReplicas: entry.active,
      idleReplicas: entry.replicas - entry.active,
    };
  }
  // Prefer the service over its broker when their limits tie; it is the actionable diagnosis.
  const ranked = Object.values(nodes)
    .filter((node) => node.offered > 0)
    .sort(
      (a, b) =>
        (b.utilization === a.utilization ? 0 : b.utilization > a.utilization ? 1 : -1) ||
        Number(b.role === "processor") - Number(a.role === "processor"),
    );
  const bottleneck = ranked[0];
  let suggestion = bottleneck
    ? `${bottleneck.label}: ${Math.round(bottleneck.utilization * 100)}% utilized`
    : "Add entry traffic to analyze capacity.";
  if (bottleneck && bottleneck.idleReplicas) {
    const constraint = [...groups.values()]
      .flat()
      .find(
        (group) =>
          group.broker.role !== "queue" &&
          group.edges.some((edge) => edge.to === bottleneck.id) &&
          (group.allocations.get(bottleneck.id) ?? 0) < bottleneck.replicas,
      );
    if (constraint) {
      const broker = constraint.broker;
      const desired = [...constraint.allocations.keys()].reduce((sum, id) => sum + entries.get(id)!.replicas, 0);
      suggestion = `${bottleneck.label}: ${bottleneck.idleReplicas} of ${bottleneck.replicas} replicas idle - add partitions to ${broker.input.sublabel ?? broker.input.label} (${broker.props.partitions} -> ${desired})`;
    }
  } else if (bottleneck && bottleneck.utilization >= 1) {
    if (!Number.isFinite(bottleneck.utilization))
      suggestion = `${bottleneck.label}: resume the node or add a ready consumer.`;
    else if (bottleneck.role === "processor") {
      const desired = Math.max(bottleneck.replicas + 1, Math.ceil(bottleneck.replicas * bottleneck.utilization));
      suggestion = `${bottleneck.label}: raise replicas from ${bottleneck.replicas} to ${desired}.`;
    } else suggestion = `${bottleneck.label}: reduce latency or increase downstream consumer capacity.`;
  }
  if (!converged) suggestion += " Cycle demand did not converge; inspect feedback routes.";
  return { nodes, bottleneck, suggestion, converged, iterations };
}
