import { resourcePlan, type ResourcePlan } from "./resourcePlanning";
import { replicaRange, resourceCapacity } from "../model/autoscaling";
import { englishAssignmentLabel, recordAssignment, type ConsumerAssignment, type BrokerSpec } from "../model/brokers";
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
import { iterationBound } from "./iterationBound";
import { admissionCapacities } from "./admissionPlanning";
import {
  chooseAction,
  compileFilter,
  compileMix,
  compileRoutes,
  compileTable,
  matchesRequest,
  type CompiledMatch,
  type CompiledMix,
  type CompiledRoute,
  type CompiledTable,
} from "./routeMatching";
import { routeTableCapable } from "../model/requestRouting";
import { quotaKey } from "./admissionPolicy";

/** Configured demand for one request route at one node, real requests/s ("" is requests without an address). */
export interface RouteDemand {
  offered: number;
  /** Refused by this router's table: no matching rule and no Default, or no eligible target (404). */
  rejected: number;
  /** Over the matched rule's (or Default's) rate limits: rejected 429 at this router. */
  throttled: number;
}

export interface NodeCapacity {
  resourcePlan?: ResourcePlan;
  managed?: boolean;
  status?: Exclude<NodeStatus, "up">;
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
  assignment?: BrokerSpec;
  /** A network device: its throughput ceiling sets the capacity (a gateway's otherwise isn't modeled). */
  device?: boolean;
}
export interface CapacityAnalysis {
  /** Per-connection configured demand in real msg/s, computed by the same routing pass. */
  connections: Record<string, number>;
  /** The very same resolver metadata playback uses. */
  resolved: Record<string, ResolvedProps>;
  nodes: Record<string, NodeCapacity>;
  bottleneck?: NodeCapacity;
  /** The message types offered at each node (rate above zero). */
  offeredTypes: Record<string, string[]>;
  suggestion: string;
  /** False for an amplifying/unbounded cycle or when the iteration/rate cap is reached. */
  converged: boolean;
  iterations: number;
  /** Request routing: offered and refused demand per route at each node it reaches (routed documents only). */
  routeDemand?: Record<string, Record<string, RouteDemand>>;
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
  /** Request routing, compiled once per analysis as playback compiles it. */
  table?: CompiledTable;
  mix?: CompiledMix;
}
interface ConsumerGroup {
  broker: Entry;
  edges: CompiledEdge[];
  allocations: Map<string, number>;
}
type Rates = Map<string, Map<string, number>>;
const RATE_CAP = 1e12;
const serviceRate = (entry: Entry, replicas = entry.active, endpointId?: string): number => {
  if (!entry.up) return 0;
  if (entry.props.admission) {
    const slots = Math.min(
      entry.props.admission.slots ?? Infinity,
      entry.props.admission.api.maxInFlight ?? Infinity,
      entry.props.admission.fixedSlotsPerReplica === undefined
        ? Infinity
        : replicas * entry.props.admission.fixedSlotsPerReplica,
    );
    const time =
      entry.props.admission.endpoints.find((e) => e.id === endpointId)?.behaviour?.latencyMs ??
      entry.props.admission.api.latencyMs ??
      entry.props.latencyMs;
    const admission = slots === 0 ? 0 : time ? (slots * 1000) / time : Infinity;
    return entry.props.resources
      ? Math.min(admission, replicas * resourceCapacity(entry.props.resources, entry.props.concurrency, time))
      : admission;
  }
  if (entry.role === "processor") {
    if (entry.props.resources)
      return replicas * resourceCapacity(entry.props.resources, entry.props.concurrency, entry.props.latencyMs);
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
  /** Current eligible fleet, only for resource-enabled live nodes. Omitted means configured initial capacity. */
  readyReplicas?: Readonly<Record<string, number>>;
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
  const routes = compileRoutes(diagram.planning);
  for (const input of diagram.nodes) {
    const role = stencilRole(input.stencil);
    const raw = { ...input.props, ...simulation?.setup?.props?.[input.id] };
    const props = resolveProps(role, input.label, raw, input.stencil, diagram.planning);
    const replicas =
      props.resources && options.readyReplicas?.[input.id] !== undefined
        ? options.readyReplicas[input.id]
        : props.autoscaling?.mode === "on"
          ? replicaRange(props.autoscaling.controller, capacityMultiplier).initial
          : Math.max(1, Math.min(props.resources ? 10_000 : Infinity, Math.round(props.replicas * capacityMultiplier)));
    const status = options.status?.[input.id] ?? simulation?.setup?.status?.[input.id] ?? raw.status;
    entries.set(input.id, {
      input,
      role,
      props,
      replicas,
      active: replicas,
      up: status !== "down" && status !== "paused",
      down: status === "down",
      ...(routes && raw.routeTable !== undefined && routeTableCapable(input.stencil, role)
        ? { table: compileTable(raw.routeTable) }
        : {}),
      ...(routes && role === "source" ? { mix: compileMix(raw.trafficMix, routes) } : {}),
    });
  }
  const compiled = compileTopology(diagram);
  const iterationCap = iterationBound(
    entries.keys(),
    compiled.edges.filter((edge) => !edge.deny && !edge.dlq),
  );
  const outgoing = compiled.outgoing;
  // Request routing on connections, compiled as playback compiles it: a caller's address on its Request, a filter.
  const callerRoute = new Map<string, CompiledRoute>();
  const requestFilter = new Map<string, CompiledMatch>();
  if (routes)
    for (const edge of diagram.edges) {
      const filter = compileFilter(edge.props?.requestFilter);
      if (filter) requestFilter.set(edge.id, filter);
      const role = entries.get(edge.from)?.role;
      const id = edge.props?.requestRouteId;
      if (
        edge.kind === "sync" &&
        typeof id === "string" &&
        (role === "source" || role === "processor" || role === "none") &&
        routes.has(id)
      )
        callerRoute.set(edge.id, routes.get(id)!);
    }
  // A traffic class: the business type plus, in a routed document, the request route and whether an unaddressed
  // request arrives at a router as a Request (sync). Unrouted classes keep the plain type as their key.
  interface TrafficClass {
    type: string;
    route?: CompiledRoute;
    sync?: boolean;
  }
  const classes = new Map<string, TrafficClass>();
  const classKey = (type: string, route?: CompiledRoute, sync?: boolean): string => {
    if (!route && !sync) return type;
    const key = `${type}\u0000${route?.id ?? ""}\u0000${sync ? "s" : ""}`;
    if (!classes.has(key)) classes.set(key, { type, route, sync });
    return key;
  };
  const classOf = (key: string): TrafficClass => classes.get(key) ?? { type: key };
  const takes = (edge: CompiledEdge, c: TrafficClass) =>
    acceptsType(edge.filter, c.type) &&
    (!requestFilter.has(edge.id) || matchesRequest(requestFilter.get(edge.id)!, c.route));
  /** The class leaving along an edge into `to`: an unaddressed Request into a router remembers it was a Request. */
  const along = (edge: CompiledEdge, type: string, route: CompiledRoute | undefined) =>
    classKey(type, route, !route && edge.sync && !!entries.get(edge.to)?.table);
  const demand = new Map<string, Map<string, RouteDemand>>();
  // A router's decision for a traffic class never changes with rates: decided once per analysis (not per iteration),
  // with its eligible targets and its action's quota buckets.
  interface Decision {
    eligible: CompiledEdge[];
    weights: number[];
    sum: number;
    buckets: { key: string; rate: number }[];
  }
  const decisions = new Map<string, Decision | "legacy">();
  const sharedQuotas = new Map((diagram.planning?.sharedQuotas ?? []).map((q) => [q.id, q]));
  function decide(
    id: string,
    table: CompiledTable,
    key: string,
    type: string,
    route: CompiledRoute | undefined,
    sync: boolean,
  ): Decision | "legacy" {
    const cacheKey = `${id}\u0000${key}`;
    const known = decisions.get(cacheKey);
    if (known) return known;
    const choice = chooseAction(table, route, sync);
    let decision: Decision | "legacy" = "legacy";
    if (!("legacy" in choice)) {
      const eligible: CompiledEdge[] = [];
      const weights: number[] = [];
      const self = { type, route };
      if ("action" in choice)
        for (const target of choice.action.targets) {
          const edge = target.weight > 0 ? (outgoing.get(id) ?? []).find((e) => e.id === target.edgeId) : undefined;
          if (edge && takes(edge, self)) {
            eligible.push(edge);
            weights.push(target.weight);
          }
        }
      const buckets = new Map<string, number>();
      if ("action" in choice)
        for (const declared of choice.action.quotas) {
          const quota = (declared.sharedGroup ? sharedQuotas.get(declared.sharedGroup) : undefined) ?? declared;
          buckets.set(quotaKey(id, ["rule", choice.action.key], declared), (quota.amount * 1000) / quota.windowMs);
        }
      decision = {
        eligible,
        weights,
        sum: weights.reduce((a, b) => a + b, 0),
        buckets: [...buckets].map(([bucket, rate]) => ({ key: bucket, rate })),
      };
    }
    decisions.set(cacheKey, decision);
    return decision;
  }
  // Each quota bucket's offered rate, from the previous iteration (the fixed point settles them together).
  let previousBuckets = new Map<string, number>();
  let bucketOffered = new Map<string, number>();
  const routeDemandAt = (id: string, route: CompiledRoute | undefined): RouteDemand => {
    let byRoute = demand.get(id);
    if (!byRoute) demand.set(id, (byRoute = new Map()));
    const key = route?.id ?? "";
    let d = byRoute.get(key);
    if (!d) byRoute.set(key, (d = { offered: 0, rejected: 0, throttled: 0 }));
    return d;
  };
  const groups = new Map<string, ConsumerGroup[]>();
  const assigned = new Map<string, ConsumerAssignment>();
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
          broker.props.broker?.partitioned ?? false,
        );
        for (const [id, count] of allocations) {
          recordAssignment(
            assigned,
            id,
            count,
            broker.props.broker?.partitioned &&
              (diagram.planning?.revision === "p2" ||
                diagram.planning?.revision === "p3" ||
                diagram.planning?.revision === "p3-a1")
              ? broker.props.broker
              : undefined,
          );
        }
        return { broker, edges: group.edges, allocations };
      }),
    );
  }
  for (const [id, entry] of entries) {
    if (compiled.restricted.has(id)) entry.active = Math.min(entry.replicas, assigned.get(id)?.count ?? 0);
  }
  const external: Rates = new Map();
  let capped = false;
  let connections: Record<string, number> = Object.create(null);
  function add(rates: Rates, id: string, type: string, value: number, edge?: CompiledEdge): void {
    if (!(value > 0)) return;
    const types = rates.get(id) ?? new Map<string, number>();
    const sum = (types.get(type) ?? 0) + value;
    if (sum > RATE_CAP) capped = true;
    types.set(type, Math.min(RATE_CAP, sum));
    rates.set(id, types);
    if (edge) connections[edge.id] = (connections[edge.id] ?? 0) + value;
  }
  /** A source's traffic: split by its mix's proportions (addressed classes), or one unaddressed class. */
  function enter(id: string, entry: Entry, type: string, rate: number): void {
    if (!entry.mix) {
      add(external, id, type, rate);
      return;
    }
    entry.mix.routes.forEach((route, i) => add(external, id, classKey(type, route), rate * entry.mix!.proportions[i]));
  }
  if (simulation) {
    for (const profile of simulation.traffic) {
      const entry = entries.get(profile.node);
      if (entry)
        enter(
          profile.node,
          entry,
          profile.messageType ?? entry.props.messageType,
          peakRate(profile.shape) * trafficMultiplier,
        );
    }
  } else {
    for (const [id, entry] of entries)
      if (entry.role === "source") enter(id, entry, entry.props.messageType, entry.props.ratePerSec);
  }
  const groupRate = (group: ConsumerGroup, edge: CompiledEdge) => {
    const target = entries.get(edge.to)!;
    const allocated = group.allocations.get(edge.to) ?? 0;
    return allocated ? serviceRate(target, allocated, edge.endpointId) : 0;
  };
  function split(
    next: Rates,
    candidates: CompiledEdge[],
    type: string,
    rate: number,
    weights: number[],
    route?: CompiledRoute,
  ): void {
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
      if (!edge.deny) add(next, edge.to, along(edge, emittedType(edge.emits, type), route), rate * fraction, edge);
    });
  }
  function propagate(next: Rates, entry: Entry, key: string, rate: number, injected: boolean): void {
    if (!rate) return;
    const id = entry.input.id;
    const c = classOf(key);
    let type = c.type;
    const route = c.route;
    if (routes) routeDemandAt(id, route).offered += rate;
    if (entry.role === "processor" || entry.role === "none") type = emittedType(entry.props.emits, type);
    const self = { type, route };
    if (entry.table && entry.role === "gateway") {
      const decision = decide(id, entry.table, key, type, route, !!c.sync);
      if (decision !== "legacy") {
        if (!decision.eligible.length) {
          routeDemandAt(id, route).rejected += rate;
          return;
        }
        // The action's quotas admit at most their rate (shared buckets across every action that names them); the
        // rest is rejected 429 here and goes no further, as in playback.
        let admitted = rate;
        for (const bucket of decision.buckets) {
          bucketOffered.set(bucket.key, (bucketOffered.get(bucket.key) ?? 0) + rate);
          const offered = previousBuckets.get(bucket.key) ?? 0;
          if (offered > bucket.rate) admitted = Math.min(admitted, (rate * bucket.rate) / offered);
        }
        if (admitted < rate) routeDemandAt(id, route).throttled += rate - admitted;
        decision.eligible.forEach((edge, i) => {
          // A deny rule's share is blocked at this router and goes no further.
          if (!edge.deny)
            add(
              next,
              edge.to,
              along(edge, emittedType(edge.emits, type), route),
              (admitted * decision.weights[i]) / decision.sum,
              edge,
            );
        });
        return;
      }
    }
    const routesOut = (outgoing.get(id) ?? []).filter((edge) => takes(edge, { type, route: branchRoute(edge, route) }));
    if (brokerRole(entry.role)) {
      for (const group of groups.get(id) ?? []) {
        const accepting = group.edges.filter((edge) => takes(edge, self));
        const allowed = accepting.filter((edge) => !edge.deny);
        const weights = allowed.map(
          (edge) => groupRate(group, edge) / allowed.filter((candidate) => candidate.to === edge.to).length,
        );
        if (allowed.length === accepting.length) split(next, accepting, type, rate, weights, route);
        else {
          // A deny rule is an unbounded exit (playback: always ready, no slot): each allowed route takes its round-robin
          // share at most what it can handle, and the rest is blocked at the broker.
          const share = rate / accepting.length;
          allowed.forEach((edge, i) =>
            add(next, edge.to, along(edge, emittedType(edge.emits, type), route), Math.min(share, weights[i]), edge),
          );
        }
      }
    } else if (entry.role === "gateway") {
      // Equal shares; health checks leave out targets that are down while another is up. A deny rule's share is
      // blocked at this node and goes no further.
      const healthy = entry.props.healthChecks ? routesOut.filter((edge) => !entries.get(edge.to)!.down) : routesOut;
      const pool = healthy.length ? healthy : routesOut;
      for (const edge of pool)
        if (!edge.deny) add(next, edge.to, along(edge, emittedType(edge.emits, type), route), rate / pool.length, edge);
    } else {
      for (const edge of routesOut) {
        if (edge.deny) continue;
        if (!injected && (entry.role === "sink" || (entry.role === "store" && edge.sync))) continue;
        const share =
          typeof edge.share === "number" && Number.isFinite(edge.share) ? Math.max(0, Math.min(1, edge.share)) : 1;
        add(next, edge.to, along(edge, emittedType(edge.emits, type), branchRoute(edge, route)), rate * share, edge);
      }
    }
  }
  /** A caller's explicit address on its own Request branch (playback sets it before that branch's filters). */
  function branchRoute(edge: CompiledEdge, route: CompiledRoute | undefined): CompiledRoute | undefined {
    return callerRoute.get(edge.id) ?? route;
  }
  let rates = external,
    converged = false,
    iterations = 0;
  for (; iterations < iterationCap; iterations++) {
    connections = Object.create(null);
    demand.clear();
    previousBuckets = bucketOffered;
    bucketOffered = new Map();
    const next: Rates = new Map([...external].map(([id, types]) => [id, new Map(types)]));
    for (const [id, types] of rates) {
      const entry = entries.get(id)!;
      for (const [key, rate] of types) {
        const injection = external.get(id)?.get(key) ?? 0;
        propagate(next, entry, key, injection, true);
        propagate(next, entry, key, Math.max(0, rate - injection), false);
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
    let capacity = entry.props.admission ? (entry.up ? Infinity : 0) : serviceRate(entry);
    if (brokerRole(entry.role)) {
      const limits = (groups.get(id) ?? []).map((group) => {
        const capacities = new Map(
          group.edges.filter((edge) => !edge.deny).map((edge) => [edge.to, groupRate(group, edge)]),
        );
        // A type a deny rule in this group accepts always has a way out (it's blocked), so it never limits the broker.
        const demands = [...(rates.get(id) ?? [])]
          .filter(([key]) => !group.edges.some((edge) => edge.deny && takes(edge, classOf(key))))
          .map(([key, rate]) => ({
            rate,
            consumers: [
              ...new Set(group.edges.filter((edge) => !edge.deny && takes(edge, classOf(key))).map((edge) => edge.to)),
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
      ...(!entry.up ? { status: entry.down ? ("down" as const) : ("paused" as const) } : {}),
      resourcePlan: resourcePlan(entry.props, offered, entry.active, capacityMultiplier),
      capacity,
      offered,
      utilization: ratio(offered, capacity),
      replicas: entry.replicas,
      activeReplicas: entry.active,
      idleReplicas: entry.replicas - entry.active,
      ...(assigned.get(id)?.spec ? { assignment: assigned.get(id)!.spec } : {}),
      ...(entry.role === "gateway" && entry.props.device ? { device: true } : {}),
      ...(entry.props.admission ? { managed: true } : {}),
    };
  }
  const incoming = new Map<string, CompiledEdge[]>();
  for (const edge of compiled.edges) {
    if (edge.deny || edge.dlq) continue;
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }
  const managed = [...entries].flatMap(([id, entry]) =>
    entry.props.admission
      ? [
          {
            id,
            policy: {
              ...entry.props.admission,
              slots:
                entry.props.admission.fixedSlotsPerReplica === undefined
                  ? entry.props.admission.slots
                  : Math.min(
                      entry.props.admission.slots ?? Infinity,
                      entry.active * entry.props.admission.fixedSlotsPerReplica,
                    ),
            },
            offered: nodes[id].offered,
            latencyMs: entry.props.latencyMs,
            endpoints: [
              ...(incoming.get(id) ?? []).map((e) => ({ id: e.endpointId, rate: connections[e.id] ?? 0 })),
              { rate: total(external.get(id)) },
            ],
          },
        ]
      : [],
  );
  for (const [id, capacity] of admissionCapacities(managed, diagram.planning)) {
    nodes[id].capacity = Math.min(nodes[id].capacity, capacity);
    const entry = entries.get(id)!;
    if (entry.props.resources && entry.up) {
      const policy = entry.props.admission!;
      const baseTime = policy.api.latencyMs ?? entry.props.latencyMs;
      const duration = (incoming.get(id) ?? []).reduce(
        (sum, edge) =>
          sum +
          (connections[edge.id] ?? 0) *
            (policy.endpoints.find((e) => e.id === edge.endpointId)?.behaviour?.latencyMs ?? baseTime),
        total(external.get(id)) * baseTime,
      );
      const meanTime = nodes[id].offered > 0 ? duration / nodes[id].offered : baseTime;
      nodes[id].capacity = Math.min(
        nodes[id].capacity,
        entry.active * resourceCapacity(entry.props.resources, entry.props.concurrency, meanTime),
      );
    }
    nodes[id].utilization = ratio(nodes[id].offered, nodes[id].capacity);
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
          group.broker.props.broker?.partitioned &&
          group.edges.some((edge) => edge.to === bottleneck.id) &&
          (group.allocations.get(bottleneck.id) ?? 0) < bottleneck.replicas,
      );
    if (constraint) {
      const broker = constraint.broker;
      const desired = [...constraint.allocations.keys()].reduce((sum, id) => sum + entries.get(id)!.replicas, 0);
      suggestion =
        diagram.planning?.revision === "p2" ||
        diagram.planning?.revision === "p3" ||
        diagram.planning?.revision === "p3-a1"
          ? `${broker.input.sublabel ?? broker.input.label}: ${englishAssignmentLabel(broker.props.broker)} → ${desired}`
          : `${bottleneck.label}: ${bottleneck.idleReplicas} of ${bottleneck.replicas} replicas idle - add partitions to ${broker.input.sublabel ?? broker.input.label} (${broker.props.partitions} -> ${desired})`;
    }
  } else if (bottleneck && bottleneck.utilization >= 1) {
    if (bottleneck.managed) suggestion = `${bottleneck.label}: Increase allocation or Reduce calls.`;
    else if (!Number.isFinite(bottleneck.utilization))
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
  for (const [id, types] of rates)
    offeredTypes[id] = [...new Set([...types].filter(([, rate]) => rate > 0).map(([key]) => classOf(key).type))];
  return {
    ...(routes
      ? {
          routeDemand: Object.fromEntries(
            [...demand].map(([id, byRoute]) => [id, Object.fromEntries([...byRoute].map(([r, d]) => [r, { ...d }]))]),
          ),
        }
      : {}),
    nodes,
    bottleneck,
    offeredTypes,
    suggestion,
    converged,
    iterations,
    connections,
    resolved: Object.fromEntries([...entries].map(([id, entry]) => [id, entry.props])),
  };
}
