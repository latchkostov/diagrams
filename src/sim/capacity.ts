import type { DiagramFile, DiagramNode, SimRole, Simulation } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { resolveProps, type ResolvedProps } from "./defaults";
import { activeUnits } from "../stencils/netDevices";
import { peakRate } from "./scale";
import {
  acceptsType,
  allocateGroupReplicas,
  brokerRole,
  compileTopology,
  emittedType,
  type CompiledEdge,
} from "./topology";
import type { NodeStatus } from "./types";
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
  /** A network device: its throughput ceiling sets the capacity (a gateway's otherwise isn't modeled). */
  device?: boolean;
}
export interface CapacityAnalysis {
  nodes: Record<string, NodeCapacity>;
  bottleneck?: NodeCapacity;
  /** The message types offered at each node (rate above zero). */
  offeredTypes: Record<string, string[]>;
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
  /** Down (not just paused): a gateway's health checks route around it. */
  down: boolean;
}
interface ConsumerGroup {
  broker: Entry;
  edges: CompiledEdge[];
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
  // A network device's ceiling: per unit, times the units carrying traffic (one in an active-standby pair).
  const device = entry.role === "gateway" ? entry.props.device : undefined;
  if (device) return device.perUnit * activeUnits(device.ha, replicas);
  if (entry.role === "gateway" || entry.role === "store")
    return entry.props.latencyMs ? 1000 / entry.props.latencyMs : Infinity;
  return Infinity;
};
const total = (rates: Map<string, number> | undefined) =>
  [...(rates?.values() ?? [])].reduce((sum, rate) => sum + rate, 0);
const ratio = (offered: number, capacity: number) =>
  capacity === 0 ? (offered > 0 ? Infinity : 0) : offered / capacity;

/** Largest common demand multiplier feasible with compatible consumers sharing finite service budgets.
 * Residual min-cuts identify constrained type subsets, avoiding exponential subset enumeration. */
function compatibleScale(demand: { rate: number; consumers: string[] }[], capacities: Map<string, number>): number {
  // Types with an unlimited compatible route can always use that route without consuming finite service.
  const finite = demand.filter((item) => !item.consumers.some((id) => capacities.get(id) === Infinity));
  if (!finite.length) return Infinity;
  const members = [...new Set(finite.flatMap((item) => item.consumers))];
  const total = finite.reduce((sum, item) => sum + item.rate, 0);
  let multiplier = members.reduce((sum, id) => sum + capacities.get(id)!, 0) / total;
  interface Arc {
    to: number;
    remaining: number;
    reverse: number;
  }
  const source = 0,
    sink = 1 + finite.length + members.length;
  const memberIndex = new Map(members.map((id, index) => [id, 1 + finite.length + index]));
  // As the multiplier decreases, source-side minimum cuts are nested (at most one per type).
  for (let iteration = 0; iteration <= finite.length && multiplier > 0; iteration++) {
    const graph: Arc[][] = Array.from({ length: sink + 1 }, () => []);
    function connect(from: number, to: number, remaining: number): void {
      graph[from].push({ to, remaining, reverse: graph[to].length });
      graph[to].push({ to: from, remaining: 0, reverse: graph[from].length - 1 });
    }
    finite.forEach((item, index) => {
      connect(source, 1 + index, item.rate * multiplier);
      for (const id of item.consumers) connect(1 + index, memberIndex.get(id)!, Infinity);
    });
    for (const id of members) connect(memberIndex.get(id)!, sink, capacities.get(id)!);
    let flow = 0;
    let reached: number[] = [];
    for (;;) {
      const parent = Array<number>(graph.length).fill(-1),
        via = Array<number>(graph.length).fill(-1);
      parent[source] = source;
      reached = [source];
      for (let head = 0; head < reached.length && parent[sink] < 0; head++) {
        const from = reached[head];
        graph[from].forEach((arc, index) => {
          if (arc.remaining > 1e-10 && parent[arc.to] < 0) {
            parent[arc.to] = from;
            via[arc.to] = index;
            reached.push(arc.to);
          }
        });
      }
      if (parent[sink] < 0) break;
      let amount = Infinity;
      for (let to = sink; to !== source; to = parent[to])
        amount = Math.min(amount, graph[parent[to]][via[to]].remaining);
      for (let to = sink; to !== source; to = parent[to]) {
        const arc = graph[parent[to]][via[to]];
        arc.remaining -= amount;
        graph[to][arc.reverse].remaining += amount;
      }
      flow += amount;
    }
    if (flow >= total * multiplier - 1e-8 * Math.max(1, total * multiplier)) return multiplier;
    const cut = new Set(reached);
    const constrained = finite.filter((_, index) => cut.has(1 + index));
    const budget = [...new Set(constrained.flatMap((item) => item.consumers))].reduce(
      (sum, id) => sum + capacities.get(id)!,
      0,
    );
    multiplier = budget / constrained.reduce((sum, item) => sum + item.rate, 0);
  }
  return multiplier;
}

export interface CapacityOptions {
  /** Node statuses right now (a live run's chaos), overriding the setup's and the diagram's. */
  status?: Readonly<Record<string, NodeStatus | undefined>>;
}

/** Nominal peak-demand planning: setup and multipliers apply; timeline chaos/retries/travel are excluded
 * unless `options.status` passes the run's current statuses in.
 * Demand is not clipped at upstream capacity, so downstream overloads remain visible. */
export function analyzeCapacity(
  diagram: DiagramFile,
  simulation?: Simulation,
  options: CapacityOptions = {},
): CapacityAnalysis {
  const trafficMultiplier = resolveMultiplier(simulation?.multipliers?.traffic);
  const capacityMultiplier = resolveMultiplier(simulation?.multipliers?.capacity);
  const entries = new Map<string, Entry>();
  for (const input of diagram.nodes) {
    const role = stencilRole(input.stencil);
    const raw = { ...input.props, ...simulation?.setup?.props?.[input.id] };
    const props = resolveProps(role, input.label, raw, input.stencil);
    const replicas = Math.max(1, Math.round(props.replicas * capacityMultiplier));
    const status = options.status?.[input.id] ?? simulation?.setup?.status?.[input.id] ?? raw.status;
    entries.set(input.id, {
      input,
      role,
      props,
      replicas,
      active: replicas,
      up: status !== "down" && status !== "paused",
      down: status === "down",
    });
  }
  const compiled = compileTopology(diagram);
  const outgoing = compiled.outgoing;
  const groups = new Map<string, ConsumerGroup[]>();
  const assigned = new Map<string, number>();
  for (const [id, compiledGroups] of compiled.groups) {
    const broker = entries.get(id)!;
    groups.set(
      id,
      compiledGroups.map((group) => {
        const allocations = allocateGroupReplicas(
          broker.role,
          broker.props.partitions,
          group.members.map((id) => {
            const target = entries.get(id)!;
            return { id, role: target.role, replicas: target.replicas };
          }),
        );
        for (const [id, count] of allocations) assigned.set(id, Math.max(assigned.get(id) ?? 0, count));
        return { broker, edges: group.edges, allocations };
      }),
    );
  }
  for (const [id, entry] of entries) {
    if (compiled.restricted.has(id)) entry.active = Math.min(entry.replicas, assigned.get(id) ?? 0);
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
  const groupRate = (group: ConsumerGroup, edge: CompiledEdge) => {
    const target = entries.get(edge.to)!;
    const allocated = group.allocations.get(edge.to) ?? 0;
    return allocated ? serviceRate(target, allocated) : 0;
  };
  function split(next: Rates, candidates: CompiledEdge[], type: string, rate: number, weights: number[]): void {
    const infinite = weights.filter((weight) => weight === Infinity).length;
    const sum = weights.reduce((value, weight) => value + (Number.isFinite(weight) ? weight : 0), 0);
    candidates.forEach((edge, index) => {
      const fraction = infinite
        ? weights[index] === Infinity
          ? 1 / infinite
          : 0
        : sum
          ? weights[index] / sum
          : 1 / candidates.length;
      // A deny rule's share is blocked at the broker and goes no further.
      if (!edge.deny) add(next, edge.to, emittedType(edge.emits, type), rate * fraction);
    });
  }
  function propagate(next: Rates, entry: Entry, type: string, rate: number, injected: boolean): void {
    if (!rate) return;
    const id = entry.input.id;
    if (entry.role === "processor" || entry.role === "none") type = emittedType(entry.props.emits, type);
    const routes = (outgoing.get(id) ?? []).filter((edge) => acceptsType(edge.filter, type));
    if (brokerRole(entry.role)) {
      for (const group of groups.get(id) ?? []) {
        const accepting = group.edges.filter((edge) => acceptsType(edge.filter, type));
        const allowed = accepting.filter((edge) => !edge.deny);
        const weights = allowed.map(
          (edge) => groupRate(group, edge) / allowed.filter((candidate) => candidate.to === edge.to).length,
        );
        if (allowed.length === accepting.length) split(next, accepting, type, rate, weights);
        else {
          // A deny rule is an unbounded exit (playback: always ready, no slot): each allowed route takes its round-robin
          // share at most what it can handle, and the rest is blocked at the broker.
          const share = rate / accepting.length;
          allowed.forEach((edge, i) => add(next, edge.to, emittedType(edge.emits, type), Math.min(share, weights[i])));
        }
      }
    } else if (entry.role === "gateway") {
      // Equal shares; health checks leave out targets that are down while another is up. A deny rule's share is
      // blocked at this node and goes no further.
      const healthy = entry.props.healthChecks ? routes.filter((edge) => !entries.get(edge.to)!.down) : routes;
      const pool = healthy.length ? healthy : routes;
      for (const edge of pool) if (!edge.deny) add(next, edge.to, emittedType(edge.emits, type), rate / pool.length);
    } else {
      for (const edge of routes) {
        if (edge.deny) continue;
        if (!injected && (entry.role === "sink" || (entry.role === "store" && edge.sync))) continue;
        const share =
          typeof edge.share === "number" && Number.isFinite(edge.share) ? Math.max(0, Math.min(1, edge.share)) : 1;
        add(next, edge.to, emittedType(edge.emits, type), rate * share);
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
        const capacities = new Map(
          group.edges.filter((edge) => !edge.deny).map((edge) => [edge.to, groupRate(group, edge)]),
        );
        // A type a deny rule in this group accepts always has a way out (it's blocked), so it never limits the broker.
        const demands = [...(rates.get(id) ?? [])]
          .filter(([type]) => !group.edges.some((edge) => edge.deny && acceptsType(edge.filter, type)))
          .map(([type, rate]) => ({
            rate,
            consumers: [
              ...new Set(
                group.edges.filter((edge) => !edge.deny && acceptsType(edge.filter, type)).map((edge) => edge.to),
              ),
            ],
          }))
          .filter((demand) => demand.consumers.length);
        if (!demands.length) return offered ? Infinity : [...capacities.values()].reduce((sum, rate) => sum + rate, 0);
        return compatibleScale(demands, capacities) * offered;
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
      ...(entry.role === "gateway" && entry.props.device ? { device: true } : {}),
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
    } else if (entries.get(bottleneck.id)?.props.device)
      suggestion = `${bottleneck.label}: pick a bigger size, or add units to an active-active cluster.`;
    else suggestion = `${bottleneck.label}: reduce latency or increase downstream consumer capacity.`;
  }
  if (!converged) suggestion += " Cycle demand did not converge; inspect feedback routes.";
  const offeredTypes: Record<string, string[]> = Object.create(null);
  for (const [id, types] of rates) offeredTypes[id] = [...types].filter(([, rate]) => rate > 0).map(([type]) => type);
  return { nodes, bottleneck, offeredTypes, suggestion, converged, iterations };
}
