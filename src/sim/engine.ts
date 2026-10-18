import { faultTopology, faultActive, faultKey, faultProblem, type Fault } from "../model/faults";
import { clearResourceWork, shiftWorkDeadlines, createCpuPartBudget } from "./resourceWork";
import { resourceBudgetExceeded, MAX_LIFECYCLE_REPLICAS } from "../model/resourceBudget";
import { validateAllocationActions } from "./allocation";
import { t } from "../i18n/core";
import {
  sampledParts,
  releaseCpuParts,
  canDrainSampled,
  retainSampledDrains,
  releaseSampledDrains,
  sampledOwners,
  type CpuPart,
} from "./sampledResources";
import {
  createFleet,
  acquireReplica,
  configureConcurrency,
  releaseReplica,
  reconcileFleet,
  advanceFleet,
  chargeCpu,
  integrateResources,
  evaluateHpa,
  commitScalingChange,
  resourceReadout,
  fleetReadout,
  replicaPage,
  type Fleet,
} from "./autoscaling";
import { controllerSyncMs, replicaRange, type ExecutableController } from "../model/autoscaling";
import { evaluateCloud, onDemand, resetCloud, shiftCloud, type CloudReads } from "./cloudScalers";
import { triggerFits } from "../model/kedaBindings";
import { evaluateKeda, resetKeda, type BrokerMetric, type ScalerTrigger } from "./keda";
import type { DiagramFile, SimRole } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { messageColor } from "./colors";
import { hasServiceTime, resolveProps, type ResolvedProps } from "./defaults";
import { activeUnits } from "../stencils/netDevices";
import { pushDue, popDue } from "./dueHeap";
import { Deque } from "./deque";
import { createLineage, type Family } from "./lineage";
import {
  createLatencyBudget,
  createLatencyRecorder,
  shareLatencyRecorder,
  recordLatency,
  latencyMetrics,
  type LatencyRecorder,
} from "./latency";
import { mulberry32 } from "./rng";
import {
  acceptsType,
  allocateGroupReplicas,
  compileTopology,
  deadLetterRoutes,
  type CompiledTopology,
} from "./topology";
import { resolveScale, resolveMultiplier } from "./units";
import {
  attemptAdmission,
  type AdmissionPolicy,
  reconfigureAdmission,
  emptyAdmission,
  releaseAdmission,
  type AdmissionLease,
} from "./admission";
import {
  chooseAction,
  compileFilter,
  compileMix,
  compileRoutes,
  compileTable,
  drawStream,
  matchesRequest,
  nextByDeficit,
  pickWeighted,
  streamSeed,
  type CompiledMatch,
  type CompiledMix,
  type CompiledRoute,
  type CompiledTable,
} from "./routeMatching";
import { routeTableCapable } from "../model/requestRouting";
import { quotaRequirements, attemptQuotas, reconfigureQuotas, type QuotaRequirement } from "./admission";
import { QUOTA_UNITS } from "../model/admission";

import type {
  RouteCounts,
  EngineOptions,
  EngineCheckpoint,
  NodeSimProps,
  NodeSimState,
  NodeStatus,
  Particle,
  ParticleKind,
  SimEngine,
  SimEvent,
  SimEventKind,
  SimFrame,
  SimSnapshot,
  TraceStep,
  TraceStepKind,
} from "./types";

const STEP = 10;
/** A refusal by a token bucket ("orders-limit: requests"): a 429, not a 404 or a concurrency cap. */
const quotaReason = (reason: string) => QUOTA_UNITS.some((unit) => reason.endsWith(`: ${unit}`));
const EWMA_ALPHA = 1 - Math.exp(-STEP / 1000);
const EVENT_CAP = 200;
/** A headless run created more messages than its shared budget (EngineOptions.messageBudget). */
export class WorkBudgetError extends Error {}

export const SOURCE_RATE_CAP = 10_000;
export const SOURCE_VOLUME_CAP = 200_000;

interface Message {
  workMs: number;
  travelMs: number;
  /** A branch that crossed a Request is outside async completion's scope. */
  requested?: true;
  id: number;
  type: string;
  color: string;
  attempts: number;
  /** Shared by the root message and all its fan-out copies. */
  family: Family;
  /** Request routing: the address this message carries (immutable, shared by copies and retries). */
  request?: CompiledRoute;
}
interface Group {
  name: string;
  edges: Edge[];
  pending: Deque<Message>;
  active: number;
  cursor: number;
  allocations: Map<string, number>;
  drainOwners: Map<string, number>;
  activeByNode: Record<string, number>;
  /** Deliveries that arrived and hold one of the group's slots at each consumer (waiting or in work). */
  heldByNode: Map<string, number>;
  /** Per consumer: deliveries that arrived while all of the group's slots there were held, in arrival order. */
  staged: Map<string, Deque<Work>>;
  /** Per consumer: the longest travel time of the group's routes to it (deny rules aside), for its pipeline. */
  travelTo: Map<string, number>;
  members: string[];
  limit: number;
}
interface Delivery {
  broker: Node;
  group: Group;
  edge: Edge;
  original: Message;
}
interface Work {
  workedAt?: number;
  /** In-place backoff advances only with the attempt's clock, including pause/resume. */
  waitRemaining?: number;
  memorySlots?: number;
  cpuParts?: CpuPart[];
  replica?: number;
  cpuRemaining?: number;
  cpuBackoffUntil?: number;
  terminating?: boolean;
  retryAdmissionAt?: number;
  lease?: AdmissionLease;
  errorRate?: number;
  message: Message;
  via?: Edge;
  delivery?: Delivery;
  remaining: number;
  retained?: boolean;
  injected?: boolean;
  /** Holds one of its delivery group's slots at the node (see admit). */
  held?: boolean;
  /** In the node's working set: it has one of the node's slots (an in-place retry keeps it). */
  slotted?: boolean;
  /** A router's table chose this connection on arrival; the work forwards there. */
  route?: RouteDecision;
}
interface RouteDecision {
  edge: Edge;
  /** The matched rule id, or "" for Default. */
  rule: string;
  weight: number;
  /** The action's quota requirements, charged with the router's own admission. */
  quotas: QuotaRequirement[];
}
interface Node {
  latency?: LatencyRecorder;
  fleet?: Fleet;
  id: string;
  label: string;
  stencil: string;
  role: SimRole;
  status: NodeStatus;
  baseStatus: NodeStatus;
  faultRate?: number;
  slowFactor?: number;
  outages: Set<string>;
  scriptedFailure?: boolean;
  rawProps: Record<string, unknown>;
  props: ResolvedProps;
  replicas: number;
  activeReplicas: number;
  outgoing: Edge[];
  dlq?: Edge;
  groups: Group[];
  pending: Deque<Work>;
  /** How many deliveries are staged here (in their groups' `staged` queues), for the backlog. */
  staged: number;
  working: Work[];
  incoming: number;
  cursor: number;
  processed: number;
  failed: number;
  deadLettered: number;
  dropped: number;
  outageDropped: number;
  /** Stopped by a deny rule on an outgoing connection (on purpose, so never `dropped`). */
  blocked: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  throughput: number;
  completedThisStep: number;
  trafficCredit: number;
  serviceCredit: number;
  /** An active-standby pair failing over holds its traffic until this time. */
  holdUntil: number;
  /** Request routing: a router's compiled table (absent: today's routing). */
  table?: CompiledTable;
  /** A source's compiled traffic mix (absent: unaddressed messages, as today). */
  mix?: CompiledMix;
  /** Per mix row: continuous traffic credit in sampled messages, and the weighted-deficit credit for fixed counts. */
  mixCredit: number[];
  mixDeficit: number[];
  /** One selection stream per table action (rule id, "" for Default), seeded lazily from the run seed. */
  streams: Map<string, number>;
  /** Refusals by request route id ("" for requests without an address). */
  routeRejections: Record<string, number>;
  /** Each table action's quota requirements, by stream key. */
  quotas: Map<string, QuotaRequirement[]>;
  /** A router's ordinary outgoing connections by id, for its table's targets. */
  targets: Map<string, Edge>;
}
interface Edge {
  cut?: boolean;
  endpointId?: string;
  id: string;
  from: Node;
  to: Node;
  sync: boolean;
  dlq: boolean;
  travelMs: number;
  share?: number;
  filter?: string[];
  emits?: string;
  deny: boolean;
  groupName: string;
  delivered: number;
  active: number;
  /** A Request out of a caller with an explicit address: copies leaving here carry it. */
  requestRoute?: CompiledRoute;
  /** Only addressed requests matching this travel the connection. */
  requestFilter?: CompiledMatch;
}
interface Trip {
  id: number;
  edge: Edge;
  message: Message;
  kind: ParticleKind;
  start: number;
  end: number;
  drawn: boolean;
  delivery?: Delivery;
  /** A reply refusing the request: 404 (no route) or 429 (a route quota). */
  code?: number;
}
interface Injection {
  node: Node;
  type: string;
  route?: CompiledRoute;
  start: number;
  interval: number;
  index: number;
  count: number;
  due: number;
  order: number;
}

function isBroker(node: Node): boolean {
  return node.role === "queue" || node.role === "topic" || node.role === "stream";
}

// Runner seed configuration for reused native engines, without widening the public contract.
const seedSetters = new WeakMap<SimEngine, (seed: number) => void>();
export function seedEngine(engine: SimEngine, seed: number): void {
  seedSetters.get(engine)?.(seed);
}

/** Fixed-step, DOM-free engine. Drawing limits never affect message delivery. */
export function createEngine(opts: EngineOptions = {}): SimEngine {
  let partBudget = createCpuPartBudget();
  let latencyBudget = createLatencyBudget();
  let seed = opts.seed ?? Math.floor(Math.random() * 4294967296);
  const roleOf = opts.roleOf ?? stencilRole;
  const maxParticles = Number.isFinite(opts.maxParticles) ? Math.max(0, Math.floor(opts.maxParticles!)) : 1500;
  let randomState = mulberry32(seed);
  let randomCalls = 0;
  const random = () => {
    randomCalls++;
    return randomState();
  };
  const nodes = new Map<string, Node>();
  let planning: DiagramFile["planning"];
  /** Request routing: the document's compiled routes (absent: routing is off and every setting dormant). */
  let routes: Map<string, CompiledRoute> | undefined;
  let routeCounts = new Map<string, RouteCounts>();
  let admission = emptyAdmission();
  let configuration: Record<string, Record<string, unknown>> | undefined;
  const edges: Edge[] = [];
  let faults = new Map<string, Fault>();
  let faultIndex: ReturnType<typeof faultTopology>;
  const faultEdges = new Map<string, Edge>();
  let trips: Trip[] = [];
  let drawn = 0;
  let drawnTrips = new Map<number, Trip>();
  let sourceRate = 0;
  let sourceEmitted = 0;
  let time = 0;
  let accumulator = 0;
  let speed = 1;
  let traffic = false;
  let scale = resolveScale(opts.scale);
  let capacityMultiplier = 1;
  let nextMessage = 1;
  let nextParticle = 1;
  let nextInjection = 1;
  let inSystem = 0;
  const events: SimEvent[] = [];
  let eventHead = 0;
  let topology = 0;
  let compiled: CompiledTopology = { edges: [], outgoing: new Map(), groups: new Map(), restricted: new Set() };
  const groupsByConsumer = new Map<string, Group[]>();
  const metricGroups = new Map<string, Map<string, Group>>();
  const checkpoints = new WeakMap<EngineCheckpoint, () => void>();
  const lineage = createLineage({
    time: () => time,
    find(test) {
      for (const trip of trips)
        if (test(trip.message))
          return {
            message: trip.message,
            node: trip.kind === "reply" || trip.kind === "retry" ? trip.edge.to.id : trip.edge.from.id,
          };
      for (const node of nodes.values()) {
        let work = node.working.find((w) => test(w.message)) ?? node.pending.find((w) => test(w.message));
        if (!work && node.staged)
          for (const group of groupsByConsumer.get(node.id) ?? []) {
            work = group.staged.get(node.id)?.find((w) => test(w.message));
            if (work) break;
          }
        if (work) return { message: work.message, node: node.id };
        for (const group of node.groups) {
          const queued = group.pending.find(test);
          if (queued) return { message: queued, node: node.id };
        }
      }
      return undefined;
    },
  });
  // Min-heap contains one entry per spread batch, not one per future message.
  const injections: Injection[] = [];
  const before = (a: Injection, b: Injection) => a.due < b.due || (a.due === b.due && a.order < b.order);

  function schedule(item: Injection): void {
    let index = injections.length;
    injections.push(item);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!before(item, injections[parent])) break;
      injections[index] = injections[parent];
      index = parent;
    }
    injections[index] = item;
  }

  function unschedule(): Injection {
    const first = injections[0];
    const last = injections.pop()!;
    if (injections.length) {
      let index = 0;
      while (index * 2 + 1 < injections.length) {
        let child = index * 2 + 1;
        if (child + 1 < injections.length && before(injections[child + 1], injections[child])) child++;
        if (!before(injections[child], last)) break;
        injections[index] = injections[child];
        index = child;
      }
      injections[index] = last;
    }
    return first;
  }

  function log(kind: SimEventKind, node: Node, message?: Message, detail = ""): void {
    const event: SimEvent = {
      time,
      kind,
      nodeId: node.id,
      ...(message ? { messageId: message.id } : {}),
      text: `${node.label} ${kind}${message ? ` ${message.type} #${message.id}` : ""}${detail ? ` (${detail})` : ""}`,
    };
    if (events.length < EVENT_CAP) events.push(event);
    else {
      events[eventHead] = event;
      eventHead = (eventHead + 1) % EVENT_CAP;
    }
  }

  function processed(node: Node, message: Message): void {
    node.processed++;
    node.completedThisStep++;
    log("process", node, message);
    if (message.family.trace) step(message, "done", node.id);
    // Each node reports the root-to-here path on successful handling, including terminal arrivals.
    // This also lets an intermediate worker explain its queue without composing hop percentiles.
    if (
      !message.requested &&
      (node.role === "processor" || node.role === "gateway" || node.role === "store" || node.role === "sink")
    ) {
      const elapsed = time - message.family.bornAt;
      const work = Math.min(message.workMs, Math.max(0, elapsed - message.travelMs));
      recordLatency(
        (node.latency ??= createLatencyRecorder()),
        message.type,
        Math.max(0, elapsed - message.travelMs - work),
        work,
        message.travelMs,
        latencyBudget,
      );
    }
  }

  /** Records a lineage step for a message whose family is being traced (callers check first). */
  function step(message: Message, kind: TraceStepKind, node: string, extra?: Partial<TraceStep>): void {
    lineage.record(message.family, {
      t: time,
      kind,
      id: message.id,
      type: message.type,
      node,
      ...extra,
      ...(message.request ? { route: message.request.id } : {}),
    });
  }

  /** A message's journey ends at `node`: consumed ("end") or lost ("drop"). */
  function gone(
    node: Node,
    message: Message,
    kind: "end" | "drop" | "block" | "reject",
    reason: string,
    extra?: Partial<TraceStep>,
  ): void {
    inSystem--;
    message.family.alive--;
    // A journey finishes its route once, however many copies fan out and end.
    if (kind === "end" && message.request) {
      const done = (message.family.routesDone ??= []);
      if (!done.includes(message.request.id)) {
        done.push(message.request.id);
        countRoute(message.request).completed++;
      }
    }
    if (message.family.trace) {
      step(message, kind, node.id, { reason, ...extra });
      lineage.settle(message.family);
    }
  }

  function countRoute(route: CompiledRoute): RouteCounts {
    let counts = routeCounts.get(route.id);
    if (!counts) routeCounts.set(route.id, (counts = { sent: 0, rejected: 0, completed: 0 }));
    return counts;
  }

  /** The same message (or copy) with another address: a caller's explicit request route. Counts the call. */
  function addressed(message: Message, route: CompiledRoute | undefined): Message {
    if (message.request?.id === route?.id) return message;
    if (route) countRoute(route).sent++;
    return { ...message, request: route };
  }

  /** Headless planning's shared message budget: refuses the message before it is allocated. */
  function spend(): void {
    const budget = opts.messageBudget;
    if (budget && --budget.remaining < 0) throw new WorkBudgetError("The run created more messages than its budget");
  }

  /** A fan-out copy with its own id, in the same family (its parent keeps the original id). */
  function copy(node: Node, message: Message): Message {
    spend();
    const next = { ...message, id: nextMessage++, attempts: 0 };
    inSystem++;
    message.family.alive++;
    if (message.family.trace) step(next, "copy", node.id, { parent: message.id });
    return next;
  }

  /** One message per route: the first route keeps the message, the others get new copies. */
  function fanOut(node: Node, message: Message, routes: number): Message[] {
    const out = [{ ...message, attempts: 0 }];
    for (let i = 1; i < routes; i++) out.push(copy(node, message));
    return out;
  }

  function drop(node: Node, message: Message, reason: string, via?: Edge): void {
    node.dropped++;
    if (reason === "node down") node.outageDropped++;
    if (opts.onLoss) {
      const boundary = node.outages.values().next().value;
      const fault =
        reason === "link cut" && via
          ? { kind: "link" as const, edge: via.id, cut: true }
          : reason === "node down" && boundary
            ? { kind: "boundary" as const, boundary, down: true }
            : reason === "processing failed" && node.faultRate !== undefined
              ? { kind: "fail" as const, node: node.id, rate: node.faultRate as 0.1 | 0.5 }
              : undefined;
      opts.onLoss({
        node: node.id,
        connection: via?.id,
        reason,
        fault,
        intentional:
          reason === "link cut" || reason === "node down"
            ? "down"
            : reason === "processing failed" && (node.faultRate !== undefined || node.scriptedFailure)
              ? "fails"
              : undefined,
      });
    }
    log("drop", node, message, reason);
    gone(node, message, "drop", reason);
  }

  /** A deny rule on `edge` stops the message at its source: blocked on purpose, not lost. */
  function block(message: Message, edge: Edge, extra?: Partial<TraceStep>): void {
    const node = edge.from;
    node.blocked++;
    log("block", node, message, `deny rule to ${edge.to.label}`);
    gone(node, message, "block", "deny rule", extra);
  }

  /**
   * Every downstream delivery (a forward, a fan-out copy, a change feed, a broker's delivery, a dead letter) goes
   * through here, so a deny rule holds on every path. Replies and retries travel back and aren't deliveries.
   */
  function deliver(
    edge: Edge,
    message: Message,
    kind: "message" | "dlq",
    delivery?: Delivery,
    extra?: Partial<TraceStep>,
  ): void {
    if (edge.deny) block(message, edge, extra);
    else if (cut(edge)) cutPush(edge, message);
    else travel(edge, message, kind, delivery, 0, undefined, extra);
  }

  /** A connection takes a message when its type filter does and, if it has one, its request filter matches. */
  function accepts(edge: Edge, message: Message): boolean {
    return (
      acceptsType(edge.filter, message.type) &&
      (edge.requestFilter === undefined || matchesRequest(edge.requestFilter, message.request))
    );
  }

  function rename(message: Message, type: string | undefined): Message {
    return type === undefined || type === message.type ? message : { ...message, type, color: messageColor(type) };
  }

  function boundaryDown(node: Node): boolean {
    return node.outages.size > 0;
  }

  function changeStatus(node: Node, status: NodeStatus): void {
    if (node.status === status) return;
    if (node.fleet) {
      const f = node.fleet;
      if (node.status === "paused") {
        const duration = time - (f.pausedAt ?? 0);
        for (const c of f.starts) c.at += duration;
        for (const c of f.sampledDrains) c.at += duration;
        for (const busy of f.busy.values()) if (busy.drainAt !== undefined) busy.drainAt += duration;
        for (const work of nodeWork(node)) shiftWorkDeadlines(work, duration);
        f.pausedAt = undefined;
        if (f.keda) {
          f.keda.createdAt += duration;
          if (f.keda.lastActive !== undefined) f.keda.lastActive += duration;
        }
        shiftCloud(f, duration);
        scheduleController(node);
      }
      f.paused = status === "paused";
      if (f.paused) f.pausedAt = time;
    }
    node.status = status;
    log("status", node, undefined, status);
  }

  const cut = (edge: Edge): boolean => edge.cut === true;

  function faultProps(node: Node, props: ResolvedProps): ResolvedProps {
    const slow = faults.get(faultKey({ kind: "slow", node: node.id, factor: 1 }));
    if (slow?.kind !== "slow") return props;
    return {
      ...props,
      latencyMs: props.latencyMs * slow.factor,
      ...(props.resources
        ? { resources: { ...props.resources, cpuMsPerMessage: props.resources.cpuMsPerMessage * slow.factor } }
        : {}),
    };
  }

  function cutPush(edge: Edge, message: Message): void {
    if (edge.to.role === "processor") {
      edge.to.failed++;
      log("fail", edge.to, message, "link cut");
      if (message.family.trace) step(message, "fail", edge.to.id, { edge: edge.id });
    }
    drop(edge.to, message, "link cut", edge);
  }

  function latency(node: Node): number {
    if (!node.props.latencyMs) return 0;
    return node.props.latencyMs * (1 + (node.props.jitter ? (random() * 2 - 1) * node.props.jitter : 0));
  }

  function slots(node: Node): number {
    if (node.props.admission) return node.props.admission.slots ?? node.props.admission.api.maxInFlight ?? Infinity;
    return node.role === "processor" ? node.activeReplicas * node.props.concurrency : node.props.concurrency;
  }

  /** A network device's throughput ceiling in real messages/s: per unit, times the units carrying traffic. */
  function ceiling(node: Node): number {
    const device = node.props.device;
    return device ? device.perUnit * activeUnits(device.ha, node.replicas) : Infinity;
  }

  /** An active-standby pair whose active unit just failed: traffic waits for the standby to take over. */
  function held(node: Node): boolean {
    return node.status === "up" && time < node.holdUntil;
  }

  function indexGroups(): void {
    groupsByConsumer.clear();
    metricGroups.clear();
    for (const broker of nodes.values()) metricGroups.set(broker.id, new Map(broker.groups.map((g) => [g.name, g])));
    for (const broker of nodes.values())
      for (const group of broker.groups)
        for (const id of group.members) {
          const memberships = groupsByConsumer.get(id) ?? [];
          memberships.push(group);
          groupsByConsumer.set(id, memberships);
        }
  }

  function readBrokerMetric(trigger: ScalerTrigger): BrokerMetric | undefined {
    if (trigger.type === "http") return undefined;
    const broker = nodes.get(trigger.source.node);
    if (!broker || broker.status !== "up" || !isBroker(broker) || !triggerFits(trigger.type, broker.stencil)) return;
    const group = metricGroups.get(broker.id)?.get(trigger.source.group ?? "queue");
    if (!group)
      return broker.role === "queue" && !broker.groups.length
        ? { pending: broker.pending.length * scale, outstanding: 0 }
        : undefined;
    return {
      pending: group.pending.length * scale,
      outstanding: group.active * scale,
      ...(trigger.type === "kafka" ? { partitions: broker.props.partitions } : {}),
    };
  }

  /**
   * How many deliveries may be outstanding (travelling, waiting or in work) against `units` slots of `target`, over
   * an edge that takes `travelMs`. A delivery takes its slot when it arrives, not when it leaves the broker: the
   * slots themselves, plus enough on the way to keep them busy (units × travel ÷ service time, rounded up), plus a
   * prefetch of one so jitter doesn't leave a slot idle. So travel time animates but never limits throughput, and a
   * consumer drains at the rate capacity analysis reports. A target that finishes on arrival (a broker, a sink) or a
   * 0 ms store or gateway is never the limit.
   */
  function outstanding(units: number, target: Node, travelMs: number): number {
    if (!(units > 0)) return 0;
    const processor = target.role === "processor";
    // Only processors, stores and gateways work on what arrives; the rest (sinks, brokers, decorative nodes) finish
    // on arrival whatever latency they have saved, so they never limit a delivery.
    const works = hasServiceTime(target.role);
    if (units === Infinity || !works || (!processor && !(target.props.latencyMs > 0))) return Infinity;
    // A sampled dot costs `scale` messages of a processor's service budget (see tick): it works on units ÷ scale dots
    // at a time, so only that many (and what's on the way to them) are held for it. The rest is lag at the broker.
    // A 0 ms service is paced as one tick, so a burst can't pull a whole backlog onto the edge at once.
    const busy = processor ? units / scale : units;
    const service = processor ? Math.max(STEP, target.props.latencyMs) : target.props.latencyMs;
    return Math.ceil(busy) + Math.ceil((busy * Math.max(STEP, travelMs)) / service) + 1;
  }

  /** The longest travel time to each consumer over a group's routes, deny rules aside: indexed once per load. */
  function travelByConsumer(routes: readonly { to: string; deny: boolean; travelMs: number }[]): Map<string, number> {
    const travel = new Map<string, number>();
    for (const edge of routes) if (!edge.deny) travel.set(edge.to, Math.max(travel.get(edge.to) ?? 0, edge.travelMs));
    return travel;
  }

  function refreshGroupLimit(group: Group): void {
    if (!group.edges[0].from.props.broker?.partitioned) {
      group.limit = Infinity;
      return;
    }
    group.limit = group.members.reduce((sum, id) => {
      const target = nodes.get(id)!;
      const units = (group.allocations.get(id) ?? 0) * (target.role === "processor" ? target.props.concurrency : 1);
      return sum + outstanding(units, target, group.travelTo.get(id) ?? 0);
    }, 0);
  }

  function assignReplicas(changed: Set<string>): void {
    const affected = new Set<Group>();
    const targets = new Set(changed);
    for (const id of changed) {
      const node = nodes.get(id)!;
      node.replicas = node.fleet?.ready ?? Math.max(1, Math.round(node.props.replicas * capacityMultiplier));
      for (const group of node.groups) affected.add(group);
      for (const group of groupsByConsumer.get(id) ?? []) affected.add(group);
    }
    for (const id of changed) {
      const node = nodes.get(id)!;
      if (!node.fleet) {
        for (const group of groupsByConsumer.get(id) ?? []) group.drainOwners.delete(id);
        continue;
      }
      const owners = new Map<Group, Set<number>>();
      for (const work of node.working) {
        if (!work.delivery || work.replica === undefined || node.fleet.busy.get(work.replica)?.drainAt === undefined)
          continue;
        const pods = owners.get(work.delivery.group) ?? new Set<number>();
        pods.add(work.replica);
        owners.set(work.delivery.group, pods);
      }
      for (const group of groupsByConsumer.get(id) ?? [])
        group.drainOwners.set(
          id,
          scale > 1
            ? sampledOwners(node.working.filter((w) => w.delivery?.group === group))
            : (owners.get(group)?.size ?? 0),
        );
    }
    for (const group of affected) {
      const broker = group.edges[0].from;
      group.allocations = allocateGroupReplicas(
        broker.role,
        Math.max(0, broker.props.partitions - [...group.drainOwners.values()].reduce((sum, count) => sum + count, 0)),
        group.members.map((id) => {
          const node = nodes.get(id)!;
          return { id, role: node.role, replicas: node.replicas };
        }),
        broker.props.broker?.partitioned ?? false,
      );
      refreshGroupLimit(group);
      for (const id of group.members) targets.add(id);
    }
    // More slots for a group: what's staged at its consumers starts now.
    for (const group of affected) drainStaged(group);
    for (const id of targets) {
      const node = nodes.get(id)!;
      const assigned = compiled.restricted.has(id)
        ? (groupsByConsumer.get(id) ?? []).reduce((max, group) => Math.max(max, group.allocations.get(id) ?? 0), 0)
        : node.replicas;
      node.activeReplicas = Math.min(node.replicas, assigned);
    }
  }

  function setNodePropsBatch(patches: Record<string, NodeSimProps>, multiplier?: number): void {
    const next = resolveMultiplier(multiplier, capacityMultiplier);
    const multiplierChanged = next !== capacityMultiplier;
    if (planning?.revision === "p3-a1")
      validateAllocationActions(
        nodes.values(),
        Object.entries(patches).map(([node, props]) => ({ node, props })),
        next,
        {
          sequential: false,
          multiplierChanged,
        },
      );
    capacityMultiplier = next;
    const reconcile = new Set<Node>();
    const initialized = new Set<Node>();
    const changed = new Set<string>(),
      limits = new Set<Group>();
    const units = new Map<Node, number>();
    const admissionChanges: { id: string; policy?: AdmissionPolicy }[] = [];
    for (const [id, patch] of Object.entries(patches)) {
      const node = nodes.get(id);
      if (!node) continue;
      if (patch.resumeAutoscaling && node.fleet) {
        node.fleet.override = false;
        scheduleController(node);
        node.fleet.decision = undefined;
        Reflect.deleteProperty(node.rawProps, "resumeAutoscaling");
        configuration = undefined;
      }
      if ("failureRate" in patch) node.scriptedFailure = typeof patch.failureRate === "number" && patch.failureRate > 0;
      if (
        !(node.fleet && patch.replicas !== undefined) &&
        Object.entries(patch).every(
          ([key, value]) => key === "resumeAutoscaling" || Object.is(node.rawProps[key], value),
        )
      )
        continue;
      configuration = undefined;
      if ("replicas" in patch) units.set(node, node.props.replicas);
      if (node.fleet && patch.replicas !== undefined) {
        node.fleet.override = true;
        reconcile.add(node);
        changed.add(id);
      }
      if (node.fleet && patch.resumeAutoscaling) {
        node.fleet.override = false;
        scheduleController(node);
      }
      const previous = node.props;
      const memorySlots = node.fleet
        ? Math.min(slots(node), (node.fleet.ready + node.fleet.draining) * previous.concurrency)
        : 0;
      for (const [key, value] of Object.entries(patch)) {
        if (key === "resumeAutoscaling") continue;
        if (value === undefined) Reflect.deleteProperty(node.rawProps, key);
        else node.rawProps[key] = structuredClone(value);
      }
      const admissionChanged = ["api", "endpoints", "preset", "presetRevision"].some((key) => key in patch);
      node.props = faultProps(
        node,
        resolveProps(
          node.role,
          node.label,
          node.rawProps,
          node.stencil,
          planning,
          admissionChanged ? undefined : previous.admission,
        ),
      );
      if (node.fleet) {
        if (scale > 1 && node.props.concurrency < previous.concurrency)
          for (const work of node.working)
            if (work.cpuParts) work.memorySlots = Math.max(work.memorySlots ?? 0, memorySlots);
        configureConcurrency(node.fleet, node.props.concurrency);
      }
      if ("resources" in patch || "autoscaling" in patch) {
        if (!node.props.resources) {
          for (const work of nodeWork(node)) {
            if (node.fleet) releaseCpuParts(node.fleet, work);
            clearResourceWork(work);
          }
          node.fleet = undefined;
        } else if (!node.fleet || time === 0) {
          initializeFleet(node);
          initialized.add(node);
          const working = node.working;
          node.working = [];
          for (const work of working) {
            work.replica = undefined;
            work.cpuParts = undefined;
            if (startResources(node, work)) {
              work.workedAt = time;
              node.working.push(work);
            } else {
              work.slotted = false;
              node.pending.push(work);
            }
          }
        } else {
          const f = node.fleet,
            a = node.props.autoscaling;
          f.recommendations = [];
          f.changes = [];
          f.decision = undefined;
          f.nextSync = time + (a?.mode === "on" ? controllerSyncMs(a.controller) : 15_000);
          f.keda = undefined;
          f.cloud = undefined;
          resetController(node, f, a?.mode === "on" ? a.controller : undefined);
          reconcile.add(node);
        }
        changed.add(id);
      }
      if (admissionChanged && (previous.admission || node.props.admission))
        admissionChanges.push({ id, policy: node.props.admission });
      // A setup or timeline patch replaces a mix or table whole (never a deep merge of rows or rules).
      if ("trafficMix" in patch || "routeTable" in patch) compileNodeRouting(node);
      if (node.role === "source") sourceRate += node.props.ratePerSec - previous.ratePerSec;
      if (
        Math.max(1, Math.round(node.props.replicas * capacityMultiplier)) !== node.replicas ||
        (isBroker(node) && node.props.partitions !== previous.partitions)
      )
        changed.add(id);
      if (node.props.concurrency !== previous.concurrency || node.props.latencyMs !== previous.latencyMs)
        for (const group of groupsByConsumer.get(id) ?? []) limits.add(group);
    }
    if (admissionChanges.length) reconfigureAdmission(admission, admissionChanges, planning, time);
    for (const node of nodes.values()) {
      if (node.fleet && node.props.resources && (multiplierChanged || reconcile.has(node))) {
        const f = node.fleet,
          a = node.props.autoscaling;
        const c = a?.mode === "on" && !f.override ? a.controller : undefined;
        const range = c ? replicaRange(c, next) : undefined;
        const desired = range
          ? time === 0
            ? range.initial
            : Math.max(range.min, Math.min(range.max, f.desired))
          : Math.max(1, Math.round(node.props.replicas * next));
        if (!initialized.has(node)) {
          if (time === 0) {
            node.fleet = createFleet(desired, c ? controllerSyncMs(c) : undefined, partBudget);
            node.fleet.override = f.override;
            resetController(node, node.fleet, c);
          } else reconcileResources(node, desired);
        }
        if (patches[node.id]?.replicas !== undefined && node.fleet.override)
          node.fleet.decision = {
            at: time,
            raw: patches[node.id].replicas!,
            desired: node.fleet.desired,
            reason: "override",
            nextAt: time,
          };
        changed.add(node.id);
      }
      if (multiplierChanged && Math.max(1, Math.round(node.props.replicas * next)) !== node.replicas)
        changed.add(node.id);
    }
    if (changed.size) assignReplicas(changed);
    for (const group of limits) {
      refreshGroupLimit(group);
      drainStaged(group);
    }
    // A unit of an active-standby pair failed: its own unit count went down (a capacity multiplier never changes
    // it), at least one is left, and the run is under way (a unit missing at time zero is the starting state).
    for (const [node, before] of units)
      if (
        node.props.device?.ha === "active-standby" &&
        node.props.replicas < before &&
        node.status === "up" &&
        time > 0
      ) {
        node.holdUntil = time + node.props.device.failoverMs;
        log("status", node, undefined, `failing over to the standby (${node.props.replicas} of ${before} units left)`);
      }
  }

  function takesShare(edge: Edge): boolean {
    return edge.share === undefined || edge.share >= 1 || (edge.share > 0 && random() < edge.share);
  }

  function travel(
    edge: Edge,
    message: Message,
    kind: ParticleKind,
    delivery?: Delivery,
    delay = 0,
    code?: number,
    extra?: Partial<TraceStep>,
  ): void {
    if (kind === "message" || kind === "dlq") message = rename(message, edge.emits);
    // Replies are decorative and must never mutate the still-live branch's timings.
    if (kind !== "reply") {
      message.travelMs += Math.ceil(Math.max(STEP, edge.travelMs) / STEP) * STEP;
      if (edge.sync) message.requested = true;
    }
    const visible = drawn < maxParticles;
    if (visible) drawn++;
    edge.active++;
    if (kind === "message" || kind === "dlq") edge.to.incoming++;
    const end = time + Math.max(STEP, edge.travelMs) + delay;
    const trip: Trip = { id: nextParticle++, edge, message, kind, delivery, start: time, end, drawn: visible };
    if (code) trip.code = code;
    pushDue(trips, trip);
    if (visible) drawnTrips.set(trip.id, trip);
    if (message.family.trace) {
      const back = kind === "reply" || kind === "retry";
      step(message, "send", back ? edge.to.id : edge.from.id, { edge: edge.id, via: kind, until: end, ...extra });
    }
  }

  function acknowledge(work: Work): void {
    releaseAdmission(admission, work.lease);
    work.lease = undefined;
    if (work.delivery) {
      work.delivery.group.active--;
      work.delivery.group.activeByNode[work.delivery.edge.to.id]--;
    }
    release(work);
  }

  /** Slots a partitioned group may fill at `node`: its assignment. Queues and subscription fan-out use the node pool. */
  function groupUnits(group: Group, node: Node): number {
    if (!group.edges[0].from.props.broker?.partitioned) return Infinity;
    return (
      ((group.allocations.get(node.id) ?? 0) + (group.drainOwners.get(node.id) ?? 0)) *
      (node.role === "processor" ? node.props.concurrency : 1)
    );
  }

  /**
   * A delivery that arrives takes one of its group's slots at the node and waits its turn there, or, with every one
   * of them taken, is staged until one frees. Deliveries travel ahead of time (see outstanding), but a group never
   * works on more than its partitions allow, even on a consumer with free slots from other inputs.
   */
  function admit(node: Node, work: Work): void {
    const group = work.delivery?.group;
    if (group && !work.held && !hold(group, node, work)) {
      let queue = group.staged.get(node.id);
      if (!queue) group.staged.set(node.id, (queue = new Deque()));
      queue.push(work);
      node.staged++;
      return;
    }
    node.pending.push(work);
  }

  /**
   * Takes one of the group's slots at `node` for `work` if one is free. Never stages behind nothing: a live
   * reassignment can leave a group no slots at a node while deliveries are on their way to it.
   */
  function hold(group: Group, node: Node, work: Work): boolean {
    if (node.fleet && groupUnits(group, node) <= 0) return false;
    const held = group.heldByNode.get(node.id) ?? 0;
    if (held > 0 && held >= groupUnits(group, node)) return false;
    group.heldByNode.set(node.id, held + 1);
    work.held = true;
    return true;
  }

  /** The work leaves the node (done, or failed back to its broker): its group slot goes to the next staged one. */
  function release(work: Work): void {
    if (!work.held) return;
    work.held = false;
    const { group, edge } = work.delivery!;
    group.heldByNode.set(edge.to.id, (group.heldByNode.get(edge.to.id) ?? 1) - 1);
    unstage(group, edge.to);
  }

  /** Staged deliveries of `group` at `node` join its queue, in arrival order, while the group has slots there. */
  function unstage(group: Group, node: Node): void {
    const waiting = group.staged.get(node.id);
    while (waiting?.length && hold(group, node, waiting.peek()!)) {
      node.staged--;
      node.pending.push(waiting.shift()!);
    }
  }

  function drainStaged(group: Group): void {
    for (const id of group.members) unstage(group, nodes.get(id)!);
  }

  /**
   * Whether a failed delivery can retry in place: it already has one of the node's slots, or one is free now (its
   * group's too). Prefetched deliveries arriving at a down consumer can't all keep one: the rest go back to the broker.
   */
  function canRetain(node: Node, work: Work): boolean {
    if (work.terminating || work.cpuParts?.some((p) => p.drainAt !== undefined)) return false;
    if (node.fleet && work.replica !== undefined && node.fleet.busy.get(work.replica)?.drainAt !== undefined)
      return false;
    if (work.slotted && (!node.fleet || work.replica !== undefined || work.cpuParts?.length)) return true;
    if (
      node.fleet
        ? (scale === 1 ? node.fleet.active : node.working.length * scale) >= slots(node)
        : node.working.length >= slots(node)
    )
      return false;
    return !work.delivery || !!work.held || hold(work.delivery.group, node, work);
  }

  function reply(work: Work, code?: number): void {
    if (work.via?.sync) travel(work.via, work.message, "reply", undefined, 0, code);
  }

  function forward(node: Node, message: Message, decision?: RouteDecision): void {
    if (decision) {
      // The router's table chose this connection on arrival: no round-robin, no fallback.
      deliver(decision.edge, { ...message, attempts: 0 }, "message", undefined, {
        rule: decision.rule,
        weight: decision.weight,
      });
      return;
    }
    if (node.role === "processor" || node.role === "none") {
      const emits = node.props.emits;
      const type =
        typeof emits === "string"
          ? emits
          : emits && Object.hasOwn(emits, message.type)
            ? emits[message.type]
            : emits?.["*"];
      message = rename(message, type);
    }
    // A caller's explicit address applies to its own branch, before that branch's filters; others keep theirs.
    const outgoing = node.outgoing.filter(
      (edge) =>
        accepts(edge, edge.requestRoute ? addressedView(message, edge.requestRoute) : message) &&
        (node.role === "gateway" || takesShare(edge)),
    );
    // A node with nowhere to send (e.g. a final worker) is a terminal consumer, not a drop.
    if (!outgoing.length) {
      gone(node, message, "end", "consumed");
      return;
    }
    if (node.role === "gateway") {
      // Health checks: targets that are down get nothing while any other target is up.
      const healthy = node.props.healthChecks
        ? outgoing.filter((edge) => edge.to.status !== "down" && !cut(edge))
        : outgoing;
      const pool = healthy.length ? healthy : outgoing;
      deliver(pool[node.cursor++ % pool.length], { ...message, attempts: 0 }, "message");
    } else {
      const copies = fanOut(node, message, outgoing.length);
      outgoing.forEach((edge, i) =>
        deliver(edge, edge.requestRoute ? addressed(copies[i], edge.requestRoute) : copies[i], "message"),
      );
    }
  }

  /** For filtering only: the branch's message as it would leave, without counting a call that may not happen. */
  function addressedView(message: Message, route: CompiledRoute): Message {
    return message.request?.id === route.id ? message : { ...message, request: route };
  }

  function publish(node: Node, message: Message): void {
    processed(node, message);
    if (!node.groups.length) {
      // A queue without a consumer (including a DLQ queue) retains its backlog.
      node.pending.push({ message, remaining: 0 });
      message.family.parked++;
      if (message.family.trace) {
        step(message, "park", node.id);
        lineage.settle(message.family);
      }
      return;
    }
    const accepting = node.groups.filter((group) => group.edges.some((edge) => accepts(edge, message)));
    if (!accepting.length) {
      gone(node, message, "end", "no subscription accepts it");
      return;
    }
    const copies = fanOut(node, message, accepting.length);
    accepting.forEach((group, i) => group.pending.push(copies[i]));
  }

  function fail(node: Node, work: Work): void {
    // A queued retained attempt can fail again while down. Retention belongs only to this attempt.
    work.retained = false;
    node.failed++;
    log("fail", node, work.message, `attempt ${work.message.attempts + 1}`);
    if (work.message.family.trace) step(work.message, "fail", node.id, { attempt: work.message.attempts + 1 });
    if (work.delivery) {
      work.message.attempts++;
      log("retry", work.delivery.broker, work.message, `attempt ${work.message.attempts}`);
      if (work.message.family.trace && work.message.attempts < work.delivery.broker.props.maxDeliveryCount)
        step(work.message, "retry", work.delivery.broker.id, { attempt: work.message.attempts });
      if (
        node.props.retry === "inplace" &&
        work.message.attempts < work.delivery.broker.props.maxDeliveryCount &&
        canRetain(node, work)
      ) {
        work.remaining = node.props.retryBackoffMs + latency(node);
        work.waitRemaining = node.props.retryBackoffMs;
        if (node.props.resources) {
          work.cpuRemaining = node.props.resources.cpuMsPerMessage * scale;
          work.cpuBackoffUntil = time + node.props.retryBackoffMs;
          const count = work.cpuParts?.reduce((sum, p) => sum + p.last - p.first + 1, 0) ?? 0;
          for (const p of work.cpuParts ?? []) p.cpu = (work.cpuRemaining * (p.last - p.first + 1)) / count;
        }
        work.retained = true;
        if (node.props.admission) work.retryAdmissionAt = time + node.props.retryBackoffMs;
      } else {
        releaseAdmission(admission, work.lease);
        work.lease = undefined;
        release(work);
        travel(
          work.delivery.edge,
          work.message,
          "retry",
          work.delivery,
          work.message.attempts < work.delivery.broker.props.maxDeliveryCount ? node.props.retryBackoffMs : 0,
        );
      }
    } else {
      releaseAdmission(admission, work.lease);
      work.lease = undefined;
      reply(work);
      if (node.props.admission && node.status !== "down") gone(node, work.message, "end", "processing failed");
      else drop(node, work.message, node.status === "down" ? "node down" : "processing failed", work.via);
    }
  }

  function finish(node: Node, work: Work): void {
    if (node.status === "down") {
      if (work.delivery || node.role === "processor") fail(node, work);
      else {
        acknowledge(work);
        reply(work);
        drop(node, work.message, "node down", work.via);
      }
      return;
    }
    if (
      (node.role === "processor" || node.props.admission || node.faultRate !== undefined) &&
      random() < (node.faultRate ?? work.errorRate ?? node.props.failureRate)
    ) {
      fail(node, work);
      return;
    }
    acknowledge(work);
    reply(work);
    if (isBroker(node)) {
      publish(node, work.message);
      return;
    }
    processed(node, work.message);
    if (work.injected && (node.role === "sink" || node.role === "store")) forward(node, work.message);
    else if (node.role === "sink") gone(node, work.message, "end", "received");
    else if (node.role === "store") {
      // Outgoing async edges from a store model change feeds / CDC: each gets a copy.
      const feeds = node.outgoing.filter((edge) => !edge.sync && accepts(edge, work.message) && takesShare(edge));
      if (!feeds.length) {
        gone(node, work.message, "end", "stored");
        return;
      }
      const copies = fanOut(node, work.message, feeds.length);
      feeds.forEach((edge, i) => deliver(edge, copies[i], "message"));
    } else forward(node, work.message, work.route);
  }

  function reserveAdmission(node: Node, work: Work): boolean {
    const policy = node.props.admission;
    if (!policy) return true;
    releaseAdmission(admission, work.lease);
    work.lease = undefined;
    const outcome = attemptAdmission(
      admission,
      node.id,
      policy,
      work.via?.endpointId,
      planning,
      time,
      scale,
      policy.fixedSlotsPerReplica === undefined
        ? policy.slots
        : Math.min(policy.slots ?? Infinity, node.activeReplicas * policy.fixedSlotsPerReplica),
      work.route?.quotas,
    );
    if ("rejected" in outcome) {
      if (node.table) {
        refuse(node, work, outcome.rejected, quotaReason(outcome.rejected) ? 429 : undefined, work.route?.rule);
        return false;
      }
      node.rejected++;
      node.rejectionReasons[outcome.rejected] = (node.rejectionReasons[outcome.rejected] ?? 0) + 1;
      log("reject", node, work.message, outcome.rejected);
      acknowledge(work);
      reply(work);
      gone(node, work.message, "reject", outcome.rejected);
      return false;
    }
    work.lease = outcome.lease;
    work.errorRate = outcome.errorRate;
    if (outcome.latencyMs !== undefined)
      work.remaining = outcome.latencyMs * (node.slowFactor ?? 1) * (1 + (random() * 2 - 1) * node.props.jitter);
    return true;
  }

  function arrive(node: Node, work: Work): void {
    // Pushed requests (not broker deliveries) for request-rate scalers; real units.
    if (node.fleet && !work.delivery) node.fleet.arrivals += scale;
    if (node.status === "down") {
      finish(node, work);
      // An in-place retry took a free slot (canRetain); the others went back to the broker.
      if (work.retained) {
        if (!startResources(node, work)) {
          node.pending.push(work);
          return;
        }
        work.workedAt = time;
        node.working.push(work);
        work.slotted = true;
      }
      return;
    }
    // A router with a table matches the address first: a refusal or a deny rule ends the request here, before any
    // admission bucket or service time is spent.
    if (node.table && !work.route && !routeOnArrival(node, work)) return;
    if (node.props.admission) {
      const group = work.delivery?.group;
      if (group && !work.held && !hold(group, node, work)) {
        let queue = group.staged.get(node.id);
        if (!queue) group.staged.set(node.id, (queue = new Deque()));
        queue.push(work);
        node.staged++;
        return;
      }
      if (!reserveAdmission(node, work)) return;
      if (node.status === "paused") node.pending.push(work);
      else if (work.remaining <= 0 && !node.props.resources?.cpuMsPerMessage) finish(node, work);
      else {
        if (!startResources(node, work)) {
          node.pending.push(work);
          return;
        }
        work.workedAt = time;
        node.working.push(work);
        work.slotted = true;
        if (work.message.family.trace) step(work.message, "start", node.id);
      }
      return;
    }
    // Pausing a broker stops consumers pulling, not publishers appending to its log.
    if (isBroker(node)) {
      finish(node, work);
      return;
    }
    if (node.status === "paused") {
      admit(node, work);
      return;
    }
    if (node.role === "source" || node.role === "sink" || node.role === "none") {
      finish(node, work);
    } else admit(node, work);
  }

  /**
   * The router's choice for an arriving request (research §3): first matching rule, else Default, else 404. Only the
   * chosen action's positive-weight targets that pass the connection's filters are eligible; a matched rule is
   * final, so filtering never falls through to a later rule or Default. One seeded draw from the action's own
   * stream picks among them. False when the request ended here (refused, or a deny rule).
   */
  function routeOnArrival(node: Node, work: Work): boolean {
    const message = work.message;
    const choice = chooseAction(node.table!, message.request, !!work.via?.sync);
    if ("legacy" in choice) return true;
    if ("reject" in choice) {
      refuse(node, work, choice.reject, 404);
      return false;
    }
    const { action, rule } = choice;
    const eligible: Edge[] = [];
    const weights: number[] = [];
    let total = 0;
    for (const target of action.targets) {
      if (!(target.weight > 0)) continue;
      const edge = node.targets.get(target.edgeId);
      if (!edge || !accepts(edge, message)) continue;
      eligible.push(edge);
      weights.push(target.weight);
      total += target.weight;
    }
    if (!eligible.length) {
      refuse(node, work, "route-no-eligible-target", 404, rule);
      return false;
    }
    let index = 0;
    if (eligible.length > 1) {
      const state = node.streams.get(action.key) ?? streamSeed(seed, node.id, action.key);
      const draw = drawStream(state);
      node.streams.set(action.key, draw.state);
      index = pickWeighted(weights, draw.value);
    }
    const edge = eligible[index];
    work.route = { edge, rule, weight: weights[index] / total, quotas: node.quotas.get(action.key) ?? [] };
    if (edge.deny) {
      // A deny rule blocks at the sender, as today: blocked on purpose, no admission bucket debited.
      acknowledge(work);
      reply(work);
      block(message, edge, { rule, weight: work.route.weight, edge: edge.id });
      return false;
    }
    // A router without a P3 policy charges its rule's quotas now; a managed one charges them with its own (atomic).
    if (!node.props.admission && work.route.quotas.length) {
      const refused = attemptQuotas(admission, work.route.quotas, time, scale);
      if (refused) {
        refuse(node, work, refused, 429, rule);
        return false;
      }
    }
    return true;
  }

  /**
   * A router refuses a request: counted once as rejected (never dropped, failed or blocked), with its reason and
   * route, a visual refused reply where the request edge has replies, and the branch ends (lineage released).
   */
  function refuse(node: Node, work: Work, reason: string, code: number | undefined, rule?: string): void {
    const message = work.message;
    node.rejected++;
    node.rejectionReasons[reason] = (node.rejectionReasons[reason] ?? 0) + 1;
    const key = message.request?.id ?? "";
    node.routeRejections[key] = (node.routeRejections[key] ?? 0) + 1;
    if (message.request) countRoute(message.request).rejected++;
    log("reject", node, message, reason);
    acknowledge(work);
    reply(work, code);
    gone(node, message, "reject", reason, rule === undefined ? undefined : { rule });
  }

  /** The route an injected message carries: the injection's explicit one, else the source's mix (weighted deficit). */
  function injectedRoute(node: Node, explicit: CompiledRoute | undefined): CompiledRoute | undefined {
    if (explicit || !node.mix) return explicit;
    const index = nextByDeficit(node.mix.proportions, node.mixDeficit);
    return index < 0 ? undefined : node.mix.routes[index];
  }

  function emit(node: Node, type: string, injected: boolean, route?: CompiledRoute): void {
    spend();
    const id = nextMessage++;
    const message: Message = {
      id,
      type,
      color: messageColor(type),
      attempts: 0,
      workMs: 0,
      travelMs: 0,
      family: { root: id, alive: 1, parked: 0, bornAt: time },
    };
    if (route) {
      message.request = route;
      countRoute(route).sent++;
    }
    inSystem++;
    lineage.born(message.family, type, node.id, route?.id);
    if (injected) log("inject", node, message);
    arrive(node, { message, remaining: latency(node), injected });
  }

  function returned(trip: Trip): void {
    const { broker, group } = trip.delivery!;
    group.active--;
    group.activeByNode[trip.edge.to.id]--;
    trip.message = {
      ...trip.delivery!.original,
      attempts: trip.message.attempts,
      workMs: trip.message.workMs,
      travelMs: trip.message.travelMs,
      requested: trip.message.requested,
    };
    if (trip.message.attempts >= broker.props.maxDeliveryCount) {
      // A denied dead-letter route blocks the message at the broker: on purpose, so not dead-lettered either.
      if (broker.dlq?.deny && accepts(broker.dlq, trip.message)) block(trip.message, broker.dlq);
      else if (broker.dlq && accepts(broker.dlq, trip.message)) {
        broker.deadLettered++;
        log("deadletter", broker, trip.message, `${trip.message.attempts} deliveries`);
        lineage.deadLettered(trip.message, broker.id, trip.message.attempts);
        deliver(broker.dlq, trip.message, "dlq");
      } else drop(broker, trip.message, "delivery limit; no DLQ edge");
    } else group.pending.push(trip.message);
  }

  function pull(node: Node): void {
    if (node.status !== "up") return;
    for (const group of node.groups) {
      if (!group.pending.length) continue;
      // A deny rule delivers nothing and reserves no slot: it's ready even when the group's consumers are full.
      while (group.pending.length) {
        const free = group.active < group.limit;
        const message = group.pending.peek()!;
        let ready: Edge | undefined;
        for (let offset = 0; offset < group.edges.length; offset++) {
          const index = (group.cursor + offset) % group.edges.length;
          const edge = group.edges[index];
          const target = edge.to;
          if (
            !cut(edge) &&
            accepts(edge, message) &&
            (edge.deny ||
              (free &&
                target.status === "up" &&
                target.working.length + target.incoming + target.pending.length + target.staged <
                  outstanding(slots(target), target, edge.travelMs) &&
                (!node.props.broker?.partitioned ||
                  (group.activeByNode[target.id] ?? 0) <
                    outstanding(
                      (group.allocations.get(target.id) ?? 0) *
                        (target.role === "processor" ? target.props.concurrency : 1),
                      target,
                      edge.travelMs,
                    ))))
          ) {
            ready = edge;
            group.cursor = (index + 1) % group.edges.length;
            break;
          }
        }
        if (!ready) break;
        if (ready.deny) {
          group.pending.shift();
          deliver(ready, message, "message");
          continue;
        }
        group.active++;
        group.activeByNode[ready.to.id] = (group.activeByNode[ready.to.id] ?? 0) + 1;
        group.pending.shift();
        travel(ready, message, "message", { broker: node, group, edge: ready, original: message });
      }
    }
  }

  function* nodeWork(node: Node): IterableIterator<Work> {
    yield* node.working;
    yield* queuedWork(node);
  }
  function* queuedWork(node: Node): IterableIterator<Work> {
    yield* node.pending;
    for (const group of groupsByConsumer.get(node.id) ?? []) yield* group.staged.get(node.id) ?? [];
  }
  function initializeFleet(node: Node): void {
    if (!node.props.resources) {
      node.fleet = undefined;
      return;
    }
    const c = node.props.autoscaling?.mode === "on" ? node.props.autoscaling.controller : undefined;
    node.fleet = createFleet(
      c
        ? replicaRange(c, capacityMultiplier).initial
        : Math.max(1, Math.round(node.props.replicas * capacityMultiplier)),
      c ? controllerSyncMs(c) : undefined,
      partBudget,
    );
    node.fleet.paused = node.status === "paused";
    resetController(node, node.fleet, c);
    if (node.fleet.paused) node.fleet.pausedAt = time;
  }
  /** KEDA and Container Apps own a poll clock; every controller owns its next evaluation. */
  function resetController(node: Node, f: Fleet, c: ExecutableController | undefined): void {
    if (c?.kind === "keda") resetKeda(f, c, time);
    else if (c && c.kind !== "hpa") resetCloud(f, c, time, node.id, cloudReads(node));
  }
  function scheduleController(node: Node): void {
    const f = node.fleet!,
      a = node.props.autoscaling;
    if (f.keda && a?.mode === "on" && "pollingMs" in a.controller) f.keda.nextPoll = time + a.controller.pollingMs;
    f.nextSync = time + (a?.mode === "on" ? controllerSyncMs(a.controller) : 15_000);
  }
  /** Held deliveries are in this node's queue or work; the rest of its queue is pushed requests. O(groups + work). */
  function waitingRequests(node: Node): number {
    let held = 0;
    for (const group of groupsByConsumer.get(node.id) ?? []) held += group.heldByNode.get(node.id) ?? 0;
    let working = 0;
    for (const work of node.working) if (work.delivery) working++;
    return Math.max(0, node.pending.length - (held - working)) * scale;
  }
  function cloudReads(node: Node): CloudReads {
    return {
      routed(source) {
        const lb = nodes.get(source);
        if (!lb) return undefined;
        let count = 0;
        for (const edge of lb.outgoing) if (edge.to === node && edge.sync) count += edge.delivered;
        return count * scale;
      },
      waiting: () => waitingRequests(node),
      inFlight: () => node.working.length * scale,
      broker: (t) => readBrokerMetric(t),
    };
  }
  function reconcileResources(node: Node, desired: number): boolean {
    const f = node.fleet!,
      r = node.props.resources!;
    if (scale > 1 && !canDrainSampled(f, desired, node.working)) return false;
    const before = scale > 1 ? f.ranges.slice(f.rangeHead).map((c) => ({ ...c })) : [];
    // Live overrides made during a pause start on the same frozen lifecycle clock.
    const lifecycleTime = node.status === "paused" ? (f.pausedAt ?? 0) : time;
    reconcileFleet(f, desired, r, lifecycleTime, seed, node.id);
    if (scale > 1) retainSampledDrains(f, before, node.working, lifecycleTime + r.terminationGraceMs);
    return true;
  }
  function startResources(node: Node, work: Work): boolean {
    if (!node.fleet || !node.props.resources) return true;
    work.cpuRemaining ??= node.props.resources.cpuMsPerMessage * scale;
    if (scale === 1 && work.replica === undefined) {
      work.replica = acquireReplica(node.fleet, node.props.concurrency);
      if (work.replica === undefined) return false;
    }
    const r = node.props.resources,
      f = node.fleet;
    if (scale > 1 && !work.cpuParts) {
      const eligible = work.delivery?.broker.props.broker?.partitioned
        ? Math.min(node.activeReplicas, work.delivery.group.allocations.get(node.id) ?? 0)
        : node.activeReplicas;
      work.cpuParts = sampledParts(f, eligible, work.cpuRemaining, node.working);
      if (!work.cpuParts) return false;
      creditSampledMemory(node, Math.max(0, (work.cpuBackoffUntil ?? time) - time));
    }
    const occupancy =
      work.replica === undefined
        ? Math.min(scale, node.activeReplicas * node.props.concurrency) / Math.max(1, node.activeReplicas)
        : (f.busy.get(work.replica)?.count ?? 0);
    if (r.memoryLimitMiB !== undefined && r.baselineMemoryMiB + occupancy * r.memoryMiBPerMessage > r.memoryLimitMiB)
      f.unsafe = true;
    return true;
  }
  function creditSampledMemory(node: Node, backoff: number): void {
    const r = node.props.resources!;
    const cores = (r.cpuLimitMilli ?? r.availableCpuMilli ?? Infinity) / 1000;
    const residence = Math.max(STEP, node.props.latencyMs, (r.cpuMsPerMessage * node.props.concurrency) / cores);
    node.fleet!.memoryCredit += scale * (backoff + residence);
  }
  function endResources(node: Node, work: Work): void {
    if (!node.fleet) return;
    releaseReplica(node.fleet, work.replica, node.props.concurrency);
    work.replica = undefined;
    work.memorySlots = undefined;
    releaseCpuParts(node.fleet, work);
  }
  function admitPending(node: Node): void {
    const limit = node.role === "gateway" ? ceiling(node) : Infinity;
    if (node.status !== "paused" && !held(node)) {
      while (
        node.pending.length &&
        (node.status === "down" ||
          (node.fleet && scale === 1 ? node.fleet.active : node.working.length) <
            slots(node) / (node.fleet ? scale : 1))
      ) {
        // Brokers without consumers retain their messages until a new diagram is loaded.
        if (isBroker(node) && !node.groups.length) break;
        if (
          node.status === "up" &&
          ((!node.props.admission && node.role === "processor" && scale > 1 && node.props.latencyMs > 0) ||
            limit < Infinity)
        ) {
          if (node.serviceCredit < 1 - 1e-9) break;
          node.serviceCredit -= 1;
        }
        const next = node.pending.peek()!;
        if (node.status === "up" && !startResources(node, next)) break;
        const work = node.pending.shift()!;
        if (node.props.admission && !work.lease && node.status === "up" && !reserveAdmission(node, work)) {
          endResources(node, work);
          continue;
        }
        if (
          node.status === "down" ||
          (work.remaining <= 0 && !node.props.resources?.cpuMsPerMessage) ||
          isBroker(node) ||
          node.role === "source"
        ) {
          finish(node, work);
          if (work.retained) {
            if (!startResources(node, work)) {
              node.pending.push(work);
              break;
            }
            work.workedAt = time;
            node.working.push(work);
            work.slotted = true;
          } else endResources(node, work);
        } else {
          work.workedAt = time;
          node.working.push(work);
          work.slotted = true;
          if (work.message.family.trace) step(work.message, "start", node.id);
        }
      }
    }
  }

  function admitIncoming(): void {
    while (injections.length && injections[0].due <= time + 1e-8) {
      const batch = unschedule();
      emit(batch.node, batch.type, true, injectedRoute(batch.node, batch.route));
      if (++batch.index < batch.count) {
        batch.due = batch.start + batch.index * batch.interval;
        schedule(batch);
      }
    }
    if (traffic && !engine.trafficLimit())
      for (const node of nodes.values()) {
        if (node.role !== "source" || node.status !== "up") continue;
        if (node.mix) {
          emitMix(node, node.mix);
          continue;
        }
        node.trafficCredit += (node.props.ratePerSec * STEP) / (1000 * scale);
        const count = Math.min(SOURCE_VOLUME_CAP - sourceEmitted, Math.floor(node.trafficCredit + 1e-10));
        node.trafficCredit -= count;
        sourceEmitted += count;
        if (sourceEmitted === SOURCE_VOLUME_CAP && count)
          log("status", node, undefined, "continuous traffic budget reached; restart to continue");
        for (let i = 0; i < count; i++) emit(node, node.props.messageType, false);
      }
    while (trips.length && trips[0].end <= time) {
      const trip = popDue(trips);
      drawnTrips.delete(trip.id);
      trip.edge.active--;
      if (trip.drawn) drawn--;
      if (trip.kind === "retry") returned(trip);
      else if (trip.kind !== "reply") {
        trip.edge.delivered++;
        trip.edge.to.incoming--;
        if (cut(trip.edge)) {
          if (trip.delivery) returned(trip);
          else cutPush(trip.edge, trip.message);
          continue;
        }
        log("deliver", trip.edge.to, trip.message);
        lineage.arrived(trip.message, trip.edge.to.id, trip.edge.id);
        arrive(trip.edge.to, {
          message: trip.message,
          via: trip.edge,
          delivery: trip.delivery,
          remaining: latency(trip.edge.to),
        });
      }
    }
  }

  /**
   * A source's mix: each route earns its own fractional credit in simulation time (a share of the source's rate, or
   * its own rate), so rare routes still emit on schedule and every route's count stays within one dot of its rate.
   * Equal-time emissions go in mix order. Each dot is one route: a dot never mixes addresses.
   */
  function emitMix(node: Node, mix: CompiledMix): void {
    for (let i = 0; i < mix.routes.length; i++) {
      const rate = mix.mode === "shares" ? node.props.ratePerSec * mix.values[i] : mix.values[i];
      node.mixCredit[i] += (rate * STEP) / (1000 * scale);
      const count = Math.min(SOURCE_VOLUME_CAP - sourceEmitted, Math.floor(node.mixCredit[i] + 1e-10));
      node.mixCredit[i] -= count;
      sourceEmitted += count;
      if (sourceEmitted === SOURCE_VOLUME_CAP && count)
        log("status", node, undefined, "continuous traffic budget reached; restart to continue");
      for (let k = 0; k < count; k++) emit(node, node.props.messageType, false, mix.routes[i]);
    }
  }

  function tick(): void {
    time += STEP;
    const fleetChanges = new Set<string>();
    for (const node of nodes.values()) {
      const f = node.fleet;
      if (!f || node.status !== "up") continue;
      if (advanceFleet(f, time, node.working)) fleetChanges.add(node.id);
    }
    if (fleetChanges.size) assignReplicas(fleetChanges);
    let resourceClock = false;
    for (const node of nodes.values())
      if (node.fleet) {
        resourceClock = true;
        break;
      }
    if (!resourceClock) admitIncoming();

    for (const node of nodes.values()) {
      // A sampled dot consumes scale messages of service budget, while keeping per-message latency.
      if (
        !node.props.admission &&
        node.role === "processor" &&
        scale > 1 &&
        node.props.latencyMs > 0 &&
        node.status === "up"
      ) {
        node.serviceCredit = Math.min(
          Math.max(1, slots(node) / scale),
          node.serviceCredit + (slots(node) * STEP) / (node.props.latencyMs * scale),
        );
      }
      // A network device admits at most its ceiling: real messages/s, in sampled dots.
      const limit = node.role === "gateway" ? ceiling(node) : Infinity;
      if (limit < Infinity && node.status === "up" && !held(node)) {
        const perTick = (limit * STEP) / (1000 * scale);
        // Room for a whole message plus a tick's worth: fractions carry over, and idle time banks no burst.
        node.serviceCredit = Math.min(1 + perTick, node.serviceCredit + perTick);
      }
      if (node.status !== "paused" && !held(node)) {
        const f = node.fleet,
          r = node.props.resources;
        const cpuBudgets = f && r ? new Map<number | string, { remaining: number; count: number }>() : undefined;
        let retained = 0,
          priorSlots = 0,
          priorOccupancy = 0;
        if (f && r) {
          const milli = r.cpuLimitMilli ?? r.availableCpuMilli ?? Infinity;
          for (const work of node.working) {
            // Work admitted under an older, larger concurrency keeps that residence; every attempt alongside it
            // (a sampled dot may round past the new capacity) still owns its memory.
            if (work.memorySlots !== undefined) priorSlots = Math.max(priorSlots, work.memorySlots);
            priorOccupancy += scale;
            if (work.cpuParts && (work.cpuBackoffUntil !== undefined || work.memorySlots !== undefined))
              retained += scale;
            if (work.cpuRemaining === undefined || (work.cpuBackoffUntil ?? 0) > time) continue;
            if (work.cpuParts) {
              for (const p of work.cpuParts)
                if (p.cpu > 0) {
                  const key = p.key,
                    budget = cpuBudgets?.get(key) ?? {
                      remaining: (milli / 1000) * STEP * (p.last - p.first + 1),
                      count: 0,
                    };
                  budget.count++;
                  cpuBudgets?.set(key, budget);
                }
            } else {
              const id = work.replica ?? 0;
              const budget = cpuBudgets?.get(id) ?? { remaining: (milli / 1000) * STEP, count: 0 };
              budget.count++;
              cpuBudgets?.set(id, budget);
            }
          }
        }
        // Retained attempts own memory throughout backoff and every retry, even after their
        // original service-time credit runs out. Ordinary sampled work keeps its residence estimate.
        const occupancy =
          f && r
            ? scale === 1
              ? node.working.length
              : Math.min(
                  Math.max(f.memoryCredit / STEP, retained),
                  Math.max(
                    // Admission limits new work; draining replicas still own retained memory.
                    Math.min(slots(node), f.ready * node.props.concurrency) + f.draining * node.props.concurrency,
                    Math.min(priorSlots, priorOccupancy),
                  ),
                )
            : 0;
        let keep = 0;
        for (const work of node.working) {
          if (work.retryAdmissionAt !== undefined && time >= work.retryAdmissionAt && node.status === "up") {
            work.retryAdmissionAt = undefined;
            work.waitRemaining = 0;
            work.workedAt = time;
            work.retained = false;
            work.remaining = latency(node);
            if (!reserveAdmission(node, work)) {
              endResources(node, work);
              work.slotted = false;
              continue;
            }
          }
          work.remaining -= STEP;
          let worked = Math.max(0, time - Math.max(work.workedAt ?? time, time - STEP));
          if (work.waitRemaining) {
            const waiting = Math.min(worked, work.waitRemaining);
            work.waitRemaining -= waiting;
            worked -= waiting;
          }
          work.message.workMs += worked;
          work.workedAt = time;
          if (f && r && node.status === "up" && (work.cpuBackoffUntil ?? 0) <= time) {
            if (work.cpuParts) {
              for (const p of work.cpuParts)
                if (p.cpu > 0) {
                  const budget = cpuBudgets?.get(p.key);
                  if (!budget) continue;
                  const spent = Math.min(p.cpu, budget.remaining / budget.count);
                  p.cpu -= spent;
                  budget.remaining -= spent;
                  budget.count--;
                  chargeCpu(f, undefined, spent, p.drainAt === undefined, time);
                }
              work.cpuRemaining = work.cpuParts.reduce((sum, p) => sum + p.cpu, 0);
            }
            const budget = !work.cpuParts && cpuBudgets?.get(work.replica ?? 0);
            if (budget && work.cpuRemaining !== undefined) {
              const spent = Math.min(work.cpuRemaining, budget.remaining / budget.count);
              work.cpuRemaining -= spent;
              budget.remaining -= spent;
              budget.count--;
              chargeCpu(f, work.replica, spent, true, time);
            }
          }
          const graceExpired =
            f &&
            ((work.replica !== undefined && (f.busy.get(work.replica)?.drainAt ?? Infinity) <= time) ||
              work.cpuParts?.some((p) => (p.drainAt ?? Infinity) <= time));
          if (graceExpired) {
            work.retained = false;
            work.terminating = true;
            work.slotted = false;
            endResources(node, work);
            fail(node, work);
          } else if (
            (work.remaining <= 0 && (node.status === "down" || (work.cpuRemaining ?? 0) <= 1e-8)) ||
            (node.status === "down" && !work.retained)
          ) {
            work.retained = false;
            finish(node, work);
            if (work.retained) node.working[keep++] = work;
            else {
              work.slotted = false;
              endResources(node, work);
            }
          } else node.working[keep++] = work;
        }
        node.working.length = keep;
        if (f && r) {
          if (scale > 1) releaseSampledDrains(f, node.working);
          if (f.assignmentChanged) {
            fleetChanges.add(node.id);
            f.assignmentChanged = false;
          }
          if (scale > 1) f.memoryCredit = Math.max(0, f.memoryCredit - occupancy * STEP);
          const a = node.props.autoscaling;
          const cloud = a?.mode === "on" && a.modelRevision === "a3" ? a.controller : undefined;
          integrateResources(
            f,
            occupancy,
            time,
            STEP,
            cloud && cloud.kind !== "ecs"
              ? {
                  inFlight: node.working.length * scale,
                  waiting: cloud.kind === "appService" ? waitingRequests(node) : 0,
                }
              : undefined,
          );
          const polled = a?.mode === "on" && (a.controller.kind === "keda" || a.controller.kind === "aca") && f.keda;
          const due = polled
            ? f.desired === 0
              ? f.keda!.nextPoll
              : Math.min(f.nextSync, f.keda!.nextPoll)
            : f.nextSync;
          const reads = cloud ? cloudReads(node) : undefined;
          const requested =
            cloud && !f.override && node.status === "up"
              ? onDemand(f, cloud, time, reads!, capacityMultiplier, node.props.concurrency)
              : undefined;
          if (a?.mode === "on" && !f.override && (time >= due || requested) && node.status === "up") {
            const decision =
              requested ??
              (a.controller.kind === "keda"
                ? evaluateKeda(f, a.controller, r, time, readBrokerMetric, capacityMultiplier, scale)
                : a.controller.kind === "hpa"
                  ? evaluateHpa(f, a.controller, r, time, capacityMultiplier, scale)
                  : evaluateCloud(
                      f,
                      a.controller,
                      r,
                      time,
                      reads!,
                      node.id,
                      capacityMultiplier,
                      scale,
                      node.props.concurrency,
                    ));
            if (decision) {
              const previous = f.desired;
              if (!reconcileResources(node, decision.desired)) {
                decision.desired = f.desired;
                decision.reason = "policy";
              } else if (
                (a.controller.kind === "keda" || a.controller.kind === "aca") &&
                decision.reason === "inactive"
              ) {
                // A successful KEDA zero transition ends this active HPA epoch.
                f.recommendations = [];
                f.changes = [];
              } else if (decision.reason !== "activation" && decision.reason !== "request")
                commitScalingChange(f, previous, time);
              if (advanceFleet(f, time, node.working) || node.replicas !== f.ready) fleetChanges.add(node.id);
            }
          }
        }
      }
      if (!node.fleet) admitPending(node);
    }
    if (fleetChanges.size) assignReplicas(fleetChanges);
    if (resourceClock) admitIncoming();
    for (const node of nodes.values()) if (node.fleet) admitPending(node);
    for (const node of nodes.values()) {
      if (isBroker(node)) pull(node);
      node.throughput += EWMA_ALPHA * ((node.completedThisStep * 1000) / STEP - node.throughput);
      node.completedThisStep = 0;
    }
    opts.verifyResources?.({
      nodes: [...nodes.values()].map((node) => ({ ...node, pending: queuedWork(node), queue: node.pending })),
      time,
      scale,
      capacityMultiplier,
      partBudget,
    });
  }

  /** Compiles a node's routing settings (load, or a live patch of trafficMix/routeTable): never per tick or message. */
  function compileNodeRouting(node: Node): void {
    const raw = node.rawProps;
    node.table =
      routes && raw.routeTable !== undefined && routeTableCapable(node.stencil, node.role)
        ? compileTable(raw.routeTable)
        : undefined;
    const quotas = new Map<string, QuotaRequirement[]>();
    if (node.table)
      for (const action of [
        ...node.table.rules.map((r) => r.action),
        ...(node.table.fallback ? [node.table.fallback] : []),
      ])
        if (action.quotas.length)
          quotas.set(action.key, quotaRequirements(node.id, action.key, action.quotas, planning));
    node.quotas = quotas;
    for (const requirements of quotas.values()) reconfigureQuotas(admission, requirements, time);
    node.mix = node.role === "source" ? compileMix(raw.trafficMix, routes) : undefined;
    node.mixCredit = node.mix ? node.mix.routes.map(() => 0) : [];
    node.mixDeficit = node.mix ? node.mix.routes.map(() => 0) : [];
  }

  function refreshSourceRate(): void {
    sourceRate = 0;
    for (const node of nodes.values()) if (node.role === "source") sourceRate += node.props.ratePerSec;
  }

  function reset(): void {
    partBudget = createCpuPartBudget();
    admission = emptyAdmission();
    reconfigureAdmission(
      admission,
      [...nodes.values()].flatMap((n) => (n.props.admission ? [{ id: n.id, policy: n.props.admission }] : [])),
      planning,
      0,
    );
    refreshSourceRate();
    time = 0;
    accumulator = 0;
    inSystem = 0;
    drawn = 0;
    nextMessage = 1;
    nextParticle = 1;
    nextInjection = 1;
    trips = [];
    drawnTrips.clear();
    sourceEmitted = 0;
    injections.length = 0;
    events.length = 0;
    eventHead = 0;
    randomCalls = 0;
    randomState = mulberry32(seed);
    lineage.reset();
    latencyBudget = createLatencyBudget();
    routeCounts = new Map();
    for (const node of nodes.values()) {
      node.latency = undefined;
      node.streams = new Map();
      node.mixCredit.fill(0);
      node.mixDeficit.fill(0);
      node.routeRejections = Object.create(null);
      initializeFleet(node);
      node.pending.clear();
      node.staged = 0;
      node.working.length = 0;
      node.incoming = 0;
      node.cursor = 0;
      node.processed = 0;
      node.failed = 0;
      node.deadLettered = 0;
      node.dropped = 0;
      node.outageDropped = 0;
      node.blocked = 0;
      node.rejected = 0;
      node.rejectionReasons = Object.create(null);
      node.holdUntil = 0;
      node.throughput = 0;
      node.completedThisStep = 0;
      node.trafficCredit = 0;
      node.serviceCredit = 0;
      for (const group of node.groups) {
        group.pending.clear();
        group.active = 0;
        group.cursor = 0;
        group.activeByNode = Object.create(null);
        group.heldByNode = new Map();
        group.staged = new Map();
      }
    }
    assignReplicas(new Set(nodes.keys()));
    for (const edge of edges) {
      edge.delivered = 0;
      edge.active = 0;
    }
  }

  lineage.setHistory(opts.traceHistory ?? 0);
  const engine: SimEngine = {
    tracer: lineage,
    validateLifecycleActions(actions) {
      if (planning?.revision !== "p3-a1" || !actions.length) return;
      validateAllocationActions(nodes.values(), actions, capacityMultiplier);
    },
    checkpoint() {
      // structuredClone preserves the graph's shared/cyclic references. Deque methods are
      // reattached on restore; its queue contents and head are ordinary own properties.
      // Clone family identity with messages, but share recordings. Lineage copies a record on its
      // first write after capture, so finished history is never deep-cloned during playback.
      lineage.shareRecords();
      const cloneGraph = <T extends { lineage: typeof lineage.state; nodes: typeof nodes }>(source: T): T => {
        const records = new Map([...source.lineage.store].map(([id, f]) => [id, f.trace]));
        const latencies = new Map([...source.nodes].map(([id, node]) => [id, node.latency]));
        let copy: T;
        try {
          // Synchronous, internal-only graph: omit records just for structuredClone's traversal.
          for (const family of source.lineage.store.values()) family.trace = undefined;
          for (const node of source.nodes.values()) node.latency = undefined;
          copy = structuredClone(source);
        } finally {
          for (const [id, family] of source.lineage.store) family.trace = records.get(id);
          for (const [id, node] of source.nodes) node.latency = latencies.get(id);
        }
        for (const [id, family] of copy.lineage.store) family.trace = records.get(id);
        for (const [id, node] of copy.nodes) {
          const recorder = latencies.get(id);
          node.latency = recorder ? shareLatencyRecorder(recorder) : undefined;
        }
        return copy;
      };
      const graph = cloneGraph({
        nodes,
        partBudget,
        latencyBudget,
        edges,
        trips,
        drawnTrips,
        injections,
        events,
        admission: { buckets: admission.buckets, inFlight: admission.inFlight },
        lineage: lineage.state,
        routeCounts,
        faults,
      });
      const clock = {
        time,
        accumulator,
        speed,
        traffic,
        sourceRate,
        sourceEmitted,
        drawn,
        nextMessage,
        nextParticle,
        nextInjection,
        inSystem,
        eventHead,
        seed,
        randomCalls,
        topology,
        scale,
        capacityMultiplier,
      };
      const token = Object.freeze({ time });
      checkpoints.set(token, () => {
        if (topology !== clock.topology) throw new Error("Checkpoint belongs to a previous diagram");
        const copy = cloneGraph(graph);
        partBudget = copy.partBudget;
        latencyBudget = copy.latencyBudget;
        nodes.clear();
        for (const [id, node] of copy.nodes) {
          Object.setPrototypeOf(node.pending, Deque.prototype);
          for (const group of node.groups) {
            Object.setPrototypeOf(group.pending, Deque.prototype);
            for (const queue of group.staged.values()) Object.setPrototypeOf(queue, Deque.prototype);
            // structuredClone gives dictionaries Object.prototype back: a consumer called "constructor" must stay a key.
            Object.setPrototypeOf(group.activeByNode, null);
          }
          Object.setPrototypeOf(node.rejectionReasons, null);
          Object.setPrototypeOf(node.routeRejections, null);
          nodes.set(id, node);
        }
        indexGroups();
        edges.splice(0, edges.length, ...copy.edges);
        faultEdges.clear();
        for (const edge of edges) faultEdges.set(edge.id, edge);
        trips = copy.trips;
        drawnTrips = copy.drawnTrips;
        injections.splice(0, injections.length, ...copy.injections);
        events.splice(0, events.length, ...copy.events);
        lineage.state = copy.lineage;
        routeCounts = copy.routeCounts;
        faults = copy.faults;
        admission = emptyAdmission();
        reconfigureAdmission(
          admission,
          [...nodes.values()].flatMap((n) => (n.props.admission ? [{ id: n.id, policy: n.props.admission }] : [])),
          planning,
          clock.time,
        );
        admission.buckets = copy.admission.buckets;
        admission.inFlight = copy.admission.inFlight;
        ({
          time,
          accumulator,
          speed,
          traffic,
          sourceRate,
          sourceEmitted,
          drawn,
          nextMessage,
          nextParticle,
          nextInjection,
          inSystem,
          eventHead,
          seed,
          randomCalls,
          scale,
          capacityMultiplier,
        } = clock);
        randomState = mulberry32((seed + Math.imul(randomCalls, 0x6d2b79f5)) >>> 0);
      });
      return token;
    },
    restore(checkpoint) {
      const restore = checkpoints.get(checkpoint);
      if (!restore) throw new Error("Checkpoint belongs to another engine");
      restore();
      configuration = undefined;
    },
    effectiveProps: (nodeId) => structuredClone(nodes.get(nodeId)?.rawProps ?? {}),
    configuration: () =>
      (configuration ??= Object.fromEntries([...nodes].map(([id, node]) => [id, structuredClone(node.rawProps)]))),
    metrics: () => ({ time, inSystem, pendingInjections: injections.length }),
    fleet(nodeId) {
      const n = nodes.get(nodeId);
      return n?.fleet && n.props.resources ? fleetReadout(n.fleet) : undefined;
    },
    replicaPage(nodeId, page) {
      const n = nodes.get(nodeId);
      return n?.fleet && n.props.resources ? replicaPage(n.fleet, n.props.resources, time, scale, page) : [];
    },
    measure(metric) {
      if ("system" in metric) return inSystem;
      const node = nodes.get(metric.node);
      if (!node) return undefined;
      if (metric.field === "inFlight") return node.working.length;
      if (metric.field === "backlog") {
        let backlog = node.pending.length + node.staged;
        for (const group of node.groups) backlog = Math.max(backlog, group.pending.length);
        return backlog;
      }
      if (metric.field === "lag") {
        if (metric.group !== undefined)
          return (
            node.groups.find((group) => group.name === metric.group)?.pending.length ??
            (node.role === "queue" && metric.group === "queue" && !node.groups.length ? node.pending.length : 0)
          );
        let lag = node.role === "queue" && !node.groups.length ? node.pending.length : 0;
        for (const group of node.groups) lag = Math.max(lag, group.pending.length);
        return lag;
      }
      return node[metric.field];
    },
    load(diagram: DiagramFile): void {
      if (resourceBudgetExceeded(diagram)) throw new Error(t("autoscaling.budget", { limit: MAX_LIFECYCLE_REPLICAS }));
      faultIndex = faultTopology(diagram);
      faults = new Map();
      faultEdges.clear();
      planning = diagram.planning;
      configuration = undefined;
      topology++;
      nodes.clear();
      edges.length = 0;
      compiled = compileTopology(diagram, roleOf);
      for (const input of diagram.nodes) {
        const role = roleOf(input.stencil);
        const rawProps = { ...input.props };
        const status = rawProps.status === "paused" || rawProps.status === "down" ? rawProps.status : "up";
        nodes.set(input.id, {
          id: input.id,
          label: input.label,
          stencil: input.stencil,
          role,
          status,
          baseStatus: status,
          outages: new Set(),
          rawProps,
          props: resolveProps(role, input.label, rawProps, input.stencil, planning),
          replicas: 1,
          activeReplicas: 1,
          outgoing: [],
          groups: [],
          pending: new Deque(),
          staged: 0,
          working: [],
          incoming: 0,
          cursor: 0,
          processed: 0,
          failed: 0,
          deadLettered: 0,
          dropped: 0,
          outageDropped: 0,
          blocked: 0,
          rejected: 0,
          rejectionReasons: Object.create(null),
          throughput: 0,
          completedThisStep: 0,
          trafficCredit: 0,
          serviceCredit: 0,
          holdUntil: 0,
          mixCredit: [],
          mixDeficit: [],
          streams: new Map(),
          routeRejections: Object.create(null),
          quotas: new Map(),
          targets: new Map(),
        });
      }
      routes = compileRoutes(planning);
      const edgeProps = routes ? new Map(diagram.edges.map((e) => [e.id, e.props])) : undefined;
      const edgeById = new Map<string, Edge>();
      const deadLetter = deadLetterRoutes(compiled);
      for (const input of compiled.edges) {
        const from = nodes.get(input.from)!,
          to = nodes.get(input.to)!;
        const edge: Edge = { ...input, from, to, delivered: 0, active: 0 };
        const props = edgeProps?.get(edge.id);
        if (props) {
          // A caller's address belongs to a Request out of a source or service; on a router's edges it's dormant.
          const caller = from.role === "source" || from.role === "processor" || from.role === "none";
          const route =
            caller && edge.sync && typeof props.requestRouteId === "string"
              ? routes!.get(props.requestRouteId)
              : undefined;
          if (route) edge.requestRoute = route;
          const filter = compileFilter(props.requestFilter);
          if (filter) edge.requestFilter = filter;
        }
        edges.push(edge);
        faultEdges.set(edge.id, edge);
        edgeById.set(edge.id, edge);
        // The route the dead-letter check reads as effective (deadLetterRoutes, topology.ts).
        if (deadLetter.get(from.id) === input) from.dlq = edge;
        else if (!edge.dlq) {
          from.outgoing.push(edge);
          from.targets.set(edge.id, edge);
        }
      }
      for (const node of nodes.values()) compileNodeRouting(node);
      for (const [id, groups] of compiled.groups) {
        const node = nodes.get(id)!;
        node.groups = groups.map((group) => ({
          name: group.name,
          edges: group.edges.map((edge) => edgeById.get(edge.id)!),
          members: group.members,
          limit: 0,
          pending: new Deque(),
          active: 0,
          cursor: 0,
          allocations: new Map(),
          drainOwners: new Map(),
          activeByNode: Object.create(null),
          heldByNode: new Map(),
          staged: new Map(),
          travelTo: travelByConsumer(group.edges),
        }));
      }
      indexGroups();
      traffic = false;
      speed = 1;
      reset();
    },
    step(dtMs: number): void {
      if (!Number.isFinite(dtMs) || dtMs <= 0) return;
      accumulator += dtMs * speed;
      const steps = Math.floor((accumulator + 1e-8) / STEP);
      accumulator = Math.max(0, accumulator - steps * STEP);
      for (let i = 0; i < steps; i++) tick();
    },
    frame() {
      const particles: Particle[] = [];
      for (const trip of drawnTrips.values())
        particles.push({
          id: trip.id,
          edgeId: trip.edge.id,
          messageId: trip.message.id,
          rootId: trip.message.family.root,
          kind: trip.kind,
          progress: Math.min(1, Math.max(0, (time - trip.start) / (trip.end - trip.start))),
          type: trip.message.type,
          color: trip.message.request?.color ?? trip.message.color,
          ...(trip.message.request ? { route: trip.message.request.id, marker: trip.message.request.marker } : {}),
          ...(trip.code ? { code: trip.code } : {}),
        });
      const nodeStates: Record<string, NodeSimState> = Object.create(null);
      for (const node of nodes.values()) {
        const lag: Record<string, number> = Object.create(null);
        let backlog = node.pending.length + node.staged;
        for (const group of node.groups) {
          lag[group.name] = group.pending.length;
          backlog = Math.max(backlog, group.pending.length);
        }
        if (node.role === "queue" && !node.groups.length) lag.queue = backlog;
        nodeStates[node.id] = {
          ...(node.latency ? { latency: latencyMetrics(node.latency) } : {}),
          id: node.id,
          role: node.role,
          status: node.status,
          backlog,
          lag,
          inFlight: node.working.length,
          processed: node.processed,
          failed: node.failed,
          deadLettered: node.deadLettered,
          dropped: node.dropped,
          ...(node.outageDropped ? { outageDropped: node.outageDropped } : {}),
          ...(node.blocked ? { blocked: node.blocked } : {}),
          ...(node.props.admission || node.table
            ? { rejected: node.rejected, rejectionReasons: { ...node.rejectionReasons } }
            : {}),
          ...(node.table ? { routeRejections: { ...node.routeRejections } } : {}),
          ...(held(node) ? { failingOver: true } : {}),
          throughput: node.throughput,
          ...(node.fleet && node.props.resources
            ? {
                fleet: fleetReadout(node.fleet),
                resources: resourceReadout(node.fleet, node.props.resources, node.working.length * scale, time, scale),
              }
            : {}),
          replicas: node.replicas,
          activeReplicas: node.activeReplicas,
          idleReplicas: node.replicas - node.activeReplicas,
          ...(isBroker(node) && !node.groups.length ? { noConsumer: true as const } : {}),
        };
      }
      const frame: SimFrame = { time, particles, nodes: nodeStates, inSystem, scale };
      if (faults.size) frame.faults = structuredClone([...faults.values()]);
      if (routes) {
        const counts: Record<string, RouteCounts> = Object.create(null);
        for (const id of routes.keys()) {
          const c = routeCounts.get(id);
          counts[id] = c ? { ...c } : { sent: 0, rejected: 0, completed: 0 };
        }
        frame.routes = counts;
      }
      return frame;
    },
    snapshot(): SimSnapshot {
      const frame = engine.frame();
      const edgeStates: SimSnapshot["edges"] = Object.create(null);
      for (const edge of edges) edgeStates[edge.id] = { id: edge.id, delivered: edge.delivered, active: edge.active };
      const recent: SimEvent[] = [];
      for (let i = 0; i < events.length; i++) recent.push({ ...events[(eventHead + i) % events.length] });
      return { ...frame, edges: edgeStates, events: recent };
    },
    inject(nodeId, count, options = {}): void {
      const node = nodes.get(nodeId);
      if (!node || !Number.isFinite(count) || count < 1) return;
      count = Math.floor(count);
      const type = options.type ?? node.props.messageType;
      // An explicit route must be one of the diagram's: never bind to something similar.
      const route = options.routeId === undefined ? undefined : routes?.get(options.routeId);
      if (options.routeId !== undefined && !route) return;
      const spread = Number.isFinite(options.spreadMs) ? Math.max(0, options.spreadMs!) : 0;
      if (!spread || count === 1) for (let i = 0; i < count; i++) emit(node, type, true, injectedRoute(node, route));
      else {
        emit(node, type, true, injectedRoute(node, route));
        const interval = spread / (count - 1);
        schedule({
          node,
          type,
          ...(route ? { route } : {}),
          start: time,
          interval,
          index: 1,
          count,
          due: time + interval,
          order: nextInjection++,
        });
      }
    },
    setFault(fault): void {
      const problem = faultProblem(fault);
      if (problem) throw new Error(problem);
      if (
        fault.kind === "boundary"
          ? !faultIndex.ranges.has(fault.boundary)
          : fault.kind === "link"
            ? !faultIndex.links.has(fault.edge)
            : !nodes.has(fault.node)
      )
        return;
      const key = faultKey(fault);
      const previous = faults.get(key);
      if (!previous && !faultActive(fault)) return;
      if (previous && JSON.stringify(previous) === JSON.stringify(fault)) return;
      if (faultActive(fault)) faults.set(faultKey(fault), structuredClone(fault));
      else faults.delete(faultKey(fault));
      if (fault.kind === "link") {
        const edge = faultEdges.get(fault.edge)!;
        edge.cut = fault.cut;
      } else if (fault.kind === "fail") {
        nodes.get(fault.node)!.faultRate = fault.rate || undefined;
      } else if (fault.kind === "boundary") {
        const range = faultIndex.ranges.get(fault.boundary)!;
        for (let i = range.start; i < range.end; i++) {
          const node = nodes.get(faultIndex.members[i])!;
          if (fault.down) node.outages.add(fault.boundary);
          else node.outages.delete(fault.boundary);
          changeStatus(node, boundaryDown(node) ? "down" : node.baseStatus);
        }
      } else if (fault.kind === "slow") {
        const node = nodes.get(fault.node)!;
        node.slowFactor = fault.factor;
        node.props = faultProps(
          node,
          resolveProps(node.role, node.label, node.rawProps, node.stencil, planning, node.props.admission),
        );
        for (const group of groupsByConsumer.get(node.id) ?? []) refreshGroupLimit(group);
      }
    },
    setNodeStatus(nodeId: string, status: NodeStatus): void {
      const node = nodes.get(nodeId);
      if (!node) return;
      node.baseStatus = status;
      changeStatus(node, boundaryDown(node) ? "down" : status);
    },
    setNodeProps(nodeId: string, patch: NodeSimProps): void {
      setNodePropsBatch({ [nodeId]: patch });
    },
    setNodePropsBatch,
    trafficLimit: () =>
      partBudget.blocked
        ? "resources"
        : sourceRate / scale > SOURCE_RATE_CAP
          ? "rate"
          : sourceEmitted >= SOURCE_VOLUME_CAP
            ? "volume"
            : undefined,
    setScale(value): void {
      const next = resolveScale(value);
      if (next === scale) return;
      scale = next;
      // A processor's time per sampled dot follows the scale, and so does what may be on the way to it.
      for (const node of nodes.values()) for (const group of node.groups) refreshGroupLimit(group);
    },
    setCapacityMultiplier(value): void {
      setNodePropsBatch({}, value);
    },
    setTraffic(on: boolean): void {
      traffic = on && !engine.trafficLimit();
    },
    setSpeed(value: number): void {
      if (Number.isFinite(value)) speed = Math.max(0.25, Math.min(8, value));
    },
    reset,
  };
  seedSetters.set(engine, (value) => {
    seed = value;
  });
  return engine;
}
