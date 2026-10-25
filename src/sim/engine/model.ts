/** Internal engine graph and structural queries. No phase or facade dependencies. */
import type { ExecutionWork } from "../executionReservations";
import type { ResourceWork, CpuTail } from "../resourceWork";
import type { Fleet } from "../autoscaling";
import type { SimRole } from "../../model/types";
import type { ResolvedProps } from "../defaults";
import type { Reservation } from "../ledger";
import type { Attempt, LogicalCall } from "../attempt";
import type { ShedQueue } from "../shedQueue";
import type { Deque } from "../deque";
import type { Family } from "../lineage";
import type { LatencyRecorder } from "../latency";
import type { CompiledMatch, CompiledMix, CompiledRoute, CompiledTable } from "../routeMatching";
import type { QuotaRequirement } from "../admission";
import type { CallPolicy } from "../callPolicy";
import type { RetryWindow, ClassifiedOutcome, OutcomeKind } from "../retryPolicy";
import type { RetryPolicy, BreakerPolicy } from "../../model/admission";
import type { BreakerState } from "../breaker";
import type { NodeStatus, ParticleKind } from "../types";

export interface Message {
  /**
   * Real requests this message carries when it is a partial dot: part of a dot split at one instant
   * (admitted and refused, kept and shed, retried apart). Undefined is a whole dot, `scale` requests.
   * The one represented size (units.ts): representedOf(m) sizes admission, threads, pools and CPU,
   * cohort(work) is that size fixed once capacity or CPU is sized (a live scale edit never resizes
   * it), and every counter adds unitsOf(m) dots. Copies, branches and replies inherit it.
   */
  represented?: number;
  /**
   * Completion credit for one request route, when a half-open breaker narrowed this message to its test calls:
   * that route's journey still finishes once at the whole cohort's size (the refused part ends off it). Any other
   * route counts the message's own size; readdressing clears it (creditRoute, addressed).
   */
  routeCohort?: { route: string; represented?: number };
  /** Real requests of this cohort that can occupy capacity at once downstream: the
   * narrowest held caller thread or finite-pool grant on its path (undefined: no limit).
   * Width never increases along a path. It is never a size: it only caps the weight
   * granted to the cohort (weight <= width, weight <= represented), which then runs in
   * represented/weight waves. */
  width?: number;
  callMs?: number;
  backoffMs?: number;
  callAttempt?: number;
  returnCall?: number;
  callDepth?: number;
  visualAt?: number;
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
export interface Group {
  offThread: number;
  offByNode: Map<string, number>;
  name: string;
  edges: Edge[];
  pending: Deque<Message>;
  /** Dots queued in pending (unitsOf): a partial dot counts its share. */
  pendingUnits: number;
  /** Dots delivered and not yet acknowledged (unitsOf); offThread, activeByNode and offByNode likewise. */
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
export interface Delivery {
  /** Dots this delivery holds in its group's counters: the delivered (possibly partial) dot. */
  units: number;
  offThread?: boolean;
  broker: Node;
  group: Group;
  edge: Edge;
  original: Message;
}
export interface Work extends ExecutionWork<Group> {
  priority?: import("../types").QueuePriority;
  queueProtected?: boolean;
  queueSize?: number;
  queuedAt?: number;
  /** Dots this work added to its node's pending, continuation or staged units when it last queued there (set on entry). */
  queuedUnits?: number;
  /** A join's continuation is a fresh attempt. It carries the join's settled cause explicitly and replies
   * with it, unless the continuation itself is ended first (an outage or a termination). */
  continuation?: { ok: boolean; cpuMs: number; cause: OutcomeKind };
  /** Pre-w2 reply code (and w2 without retry policies), as it always propagated. Never a classification. */
  failureCode?: number;
  timeoutOrigin?: string;
  attempt?: Attempt<Message>;
  residentWeight?: number;
  /** Owns its preceding thread while awaiting the ordinary continuation phase. */
  resumeAtAdmission?: boolean;
  waitingCall?: number;
  outputs?: Edge[];
  outputMessage?: Message;
  workedAt?: number;
  /** In-place backoff advances only with the attempt's clock, including pause/resume. */
  waitRemaining?: number;
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
export interface RouteDecision {
  edge: Edge;
  /** The matched rule id, or "" for Default. */
  rule: string;
  weight: number;
  /** The action's quota requirements, charged with the router's own admission. */
  quotas: QuotaRequirement[];
}
export interface Node {
  activeMs: number;
  /** Last tick-loop admission phase completed by this node. */
  admittedAt?: number;
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
  pending: Deque<Work> | ShedQueue<Work>;
  resume: Deque<Work>;
  takeovers: Work[];
  frees: boolean;
  /** How many deliveries are staged here (in their groups' `staged` queues), for the backlog. */
  staged: number;
  working: Work[];
  calls: Map<number, Call>;
  /** R2's minimum independent reservation for sampled non-blocking local work. */
  threadTails: Map<number, Reservation<Group>>;
  threadWeight: Record<"work" | "wait", number>;
  threadCount: Record<"work" | "wait", number>;
  admitting: boolean;
  admissionDirty: boolean;
  residentWeight: number;
  residentCount: number;
  requestWeight: number;
  requestCount: number;
  heldCalls: number;
  offThreadCalls: number;
  freeFlight: number;
  heldBrokerCalls: number;
  waitingOn: Map<string, number>;
  waits: boolean;
  callTarget: boolean;
  cpuTail: Set<CpuTail<Group>>;
  sampledExecution: boolean;
  cpuTick?: import("../resourceInvariants").CpuTick;
  incoming: number;
  /** Dots (unitsOf) of incoming, pending and staged: a broker's prefetch window counts real requests. */
  incomingUnits: number;
  pendingUnits: number;
  stagedUnits: number;
  queueUnits: number;
  /** Dots (unitsOf) of `working`, kept with it so occupancy reads stay constant-time. */
  workingUnits: number;
  /** Dots (unitsOf) of continuations queued in `resume`. */
  resumeUnits: number;
  cursor: number;
  processed: number;
  failed: number;
  deadLettered: number;
  dropped: number;
  outageDropped: number;
  timeoutLosses: Map<string, number>;
  /** Stopped by a deny rule on an outgoing connection (on purpose, so never `dropped`). */
  blocked: number;
  shedLost: number;
  shed: number;
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
export interface Call extends LogicalCall {
  attempt: Attempt<Message>;
  replyMs?: number;
  replies?: number;
  id: number;
  node: Node;
  work: Work;
  outstanding: Set<string>;
  held: boolean;
  /** Dots each held blocking branch added to its edge's held gauge, released as charged across scale edits. */
  heldDots?: number;
  brokerHeld?: boolean;
}
export interface Logical {
  outcome?: ClassifiedOutcome;
  backoffMs?: number;
  retry?: boolean;
  callAttempt?: number;
  /** The settling message's represented size, for weighted call counters. */
  represented?: number;
  timeoutOrigin?: string;
  timeout?: boolean;
  code?: number;
  id: number;
  end: number;
  edge?: Edge;
  message?: Message;
  call?: number;
  ok?: boolean;
  grace?: number;
  thread?: number;
  visualAt?: number;
}
export interface Edge {
  priority?: import("../types").QueuePriority;
  breaker?: { policy: BreakerPolicy; state: BreakerState };
  policy?: CallPolicy;
  poolUsed: number;
  poolPending: { id: number; end: number; call: Call; message: Message; admissibleActive: number }[];
  poolPendingIndices: Map<number, number>;
  poolLeases: Map<number, number>;
  networkDelayMs: number;
  calls: NonNullable<import("../types").EdgeSimState["calls"]>;
  retry?: { policy: RetryPolicy; stream?: number; window: RetryWindow };
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
export interface Trip {
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
  echo?: boolean;
}
export interface EchoExpiry {
  id: number;
  end: number;
  counts: Map<Edge, number>;
}
export interface Injection {
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

export function isBroker(node: Node): boolean {
  return node.role === "queue" || node.role === "topic" || node.role === "stream";
}

export interface DeliveryPart {
  index: number;
  edge: Edge;
  part: number;
}

/** Every location that can own a live message, including exclusive continuations. */
export function* liveWork(node: Node, groupsByConsumer: ReadonlyMap<string, Group[]>): IterableIterator<Work> {
  const seen = new Set<Work>();
  for (const collection of [node.working, node.takeovers, queuedWork(node, groupsByConsumer)])
    for (const work of collection)
      if (!seen.has(work)) {
        seen.add(work);
        yield work;
      }
  for (const { work } of node.calls.values())
    if (!seen.has(work)) {
      seen.add(work);
      yield work;
    }
}

export function* nodeWork(node: Node, groupsByConsumer: ReadonlyMap<string, Group[]>): IterableIterator<ResourceWork> {
  yield* new Set([...resourceWork(node), ...queuedWork(node, groupsByConsumer)]);
}
export function* queuedWork(node: Node, groupsByConsumer: ReadonlyMap<string, Group[]>): IterableIterator<Work> {
  yield* node.resume;
  yield* node.pending;
  for (const group of groupsByConsumer.get(node.id) ?? []) yield* group.staged.get(node.id) ?? [];
}
export function resourceWork(node: Node): CpuTail<Group>[] {
  return node.heldCalls || node.threadTails.size || node.takeovers.length || node.cpuTail.size
    ? [
        ...new Set<CpuTail<Group>>([
          ...node.working,
          ...node.takeovers,
          ...[...node.calls.values()].filter((c) => c.held).map((c) => c.work),
          ...node.threadTails.values(),
          ...node.cpuTail,
        ]),
      ]
    : node.working;
}
