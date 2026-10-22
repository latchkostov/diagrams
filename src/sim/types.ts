// Public contract for the simulation engine. The engine (src/sim/engine.ts) is pure TypeScript —
// no DOM, no React — so it can be unit-tested deterministically. The UI drives it with step(dt)
// from requestAnimationFrame and renders frame() each frame. Semantics: docs/SIMULATION.md.

import type { DiagramFile, Expectation, SimRole } from "../model/types";

export type NodeStatus = "up" | "paused" | "down";

/** Emitted at the loss, using the engine's resolved overlays and the actual incoming connection. */
export interface LossProvenance {
  node: string;
  connection?: string;
  reason: string;
  fault?: import("../model/faults").Fault;
  intentional?: "down" | "fails";
  /** Sampled dots this loss counts in `dropped`: 1 for a whole dot, a partial dot's share of one. */
  dots: number;
}

/** Why a particle is travelling along an edge. Drives its colour / style in the UI. */
export type ParticleKind =
  | "message" // a message (or request) moving downstream
  | "reply" // response travelling back along a sync edge
  | "retry" // a failed delivery travelling back to its broker for redelivery
  | "dlq"; // a message being dead-lettered

export interface Particle {
  callAttempt?: number;
  id: number;
  edgeId: string;
  messageId: number;
  /** The original message this one descends from (itself unless it's a fan-out copy). */
  rootId: number;
  kind: ParticleKind;
  /** 0..1 along the edge path. For reply / retry particles the UI draws it target → source. */
  progress: number;
  /** Message type, e.g. "OrderPlaced". */
  type: string;
  /** Hex colour for the particle: its request route's colour when it carries an address, else its type's. */
  color: string;
  /** Request routing: the route id and its marker, only on addressed messages (and their replies). */
  route?: string;
  marker?: import("../model/requestRouting").RouteMarker;
  /** A reply that says the request was refused: 404 (no route) or 429 (a quota). */
  code?: number;
}

/** Native engine message counts and rates are sampled units; time and replica counts are unscaled. */
export interface NodeSimState {
  threads?: {
    slots: number;
    working: number;
    waiting: number;
    waitingOn: [string, number][];
    queued: number;
    inFlight?: number;
  };
  /** Successful async root-to-node paths since restart. Sample counts and durations are never scaled. */
  latency?: LatencyMetrics;
  resources?: import("./autoscaling").ResourceReadout;
  fleet?: import("./autoscaling").FleetReadout;
  id: string;
  role: SimRole;
  status: NodeStatus;
  /** Messages waiting at this node: queue depth for queues, max consumer-group lag for topics/streams,
   *  waiting work for processors. */
  backlog: number;
  /** Per consumer group lag (topics / streams / queues). Key = group name. */
  lag: Record<string, number>;
  /**
   * A topic, stream or queue with no consumer: what it holds is kept, unread (a topic with no consumer group has
   * no lag at all; lag is per group). Absent otherwise.
   */
  noConsumer?: true;
  /** Messages currently being processed, including blocked in-place retries. */
  inFlight: number;
  /** Total messages successfully handled / stored / emitted. */
  processed: number;
  /** Total processing failures at this node (each failed attempt counts). */
  failed: number;
  /** Messages this node (as a broker) moved to its dead-letter path. */
  deadLettered: number;
  /** Messages dropped because they had nowhere to go (node down, no DLQ, etc.). */
  dropped: number;
  /** Arrival losses while down, separately from exhausted broker deliveries. */
  outageDropped?: number;
  /** Messages a deny rule on one of this node's outgoing connections stopped. On purpose: not a loss. */
  blocked?: number;
  /** Admission refusals (including throttling), separate from processing failures and losses. */
  rejected?: number;
  rejectionReasons?: Record<string, number>;
  /** A router's refusals by request route id ("" for requests without an address). */
  routeRejections?: Record<string, number>;
  /** An active-standby pair is failing over to its standby unit: traffic waits until it's done. */
  failingOver?: boolean;
  /** Smoothed throughput in messages / second (processed). */
  throughput: number;
  /** Configured and partition-assigned instances (not current busy counts). */
  replicas?: number;
  activeReplicas?: number;
  idleReplicas?: number;
}

export interface LatencySummary {
  readonly samples: number;
  /** Approximate end-to-end percentiles in ms, excluding animation travel. Never composed per hop. */
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  /** Totals over these same sampled paths; travel is animation, not physical network delay. */
  readonly waitMs: number;
  readonly workMs: number;
  readonly travelMs: number;
  /** Logical time spent awaiting calls; absent on historical paths. */
  readonly callMs?: number;
  readonly backoffMs?: number;
}

/** Immutable value view, shared between frames until the next successful sample. */
export interface LatencyMetrics extends LatencySummary {
  /** Drill samples completed since this actual fault change. */
  readonly sinceFault?: { readonly atMs: number; readonly fault: Readonly<import("../model/faults").Fault> };
  readonly byType: Readonly<Record<string, LatencySummary>>;
  /** Additional types contribute only to the total after the node or run recording limit. */
  readonly typesLimited?: true;
}

export interface RetryCallCounts {
  requests: number;
  attempts: number;
  retried: number;
  succeeded: number;
  budgetDenied: number;
  shortCircuited: number;
  ambiguous: number;
  backingOff: number;
  windowRequests: number;
  windowAttempts: number;
  windowRetried: number;
  windowSucceeded: number;
}

export interface EdgeSimState {
  calls?: { inFlight: number; held: number; timedOut: number; failed: number; late: number } & Partial<RetryCallCounts>;
  id: string;
  /** Total messages that have finished travelling this edge. */
  delivered: number;
  /** Sampled trips currently on this edge, including visual replies. */
  active: number;
}

export type SimEventKind =
  "inject" | "deliver" | "process" | "fail" | "retry" | "deadletter" | "drop" | "block" | "reject" | "status";

export interface SimEvent {
  /** Simulation time in ms. */
  time: number;
  kind: SimEventKind;
  nodeId: string;
  /** Identity of a sampled message; never multiply ids or attempt numbers by scale. */
  messageId?: number;
  /** Human readable, e.g. "payments failed OrderPlaced #42 (attempt 2/3)". */
  text: string;
}

export type SimFrame = Pick<SimSnapshot, "time" | "particles" | "nodes" | "inSystem" | "scale" | "routes" | "faults">;

/** Converted message counts/rates; the tag makes this view explicit and prevents repeat conversion. */
export type RealNodeMetrics = NodeSimState & { readonly units: "real" };
export type RealSimFrame = Omit<SimFrame, "nodes"> & {
  readonly units: "real";
  nodes: Record<string, RealNodeMetrics>;
};
export type RealSimSnapshot = Omit<SimSnapshot, "nodes"> & RealSimFrame;

/** Detached views of the same engine. Real views retain sampled particle geometry and event identities. */
export interface SimulationUnits {
  sampledFrame(): SimFrame;
  realFrame(): RealSimFrame;
  sampledSnapshot(): SimSnapshot;
  realSnapshot(): RealSimSnapshot;
}

/** Native engine snapshot: every message count/rate (nodes, edges, inSystem) is sampled. */
export interface SimSnapshot {
  /** Active runtime overlays, omitted for an ordinary run. Included in checkpoints. */
  faults?: import("../model/faults").Fault[];
  /** Real messages per simulated message. Default 1. */
  scale?: number;
  /** Simulation clock in ms (scaled by speed). */
  time: number;
  particles: Particle[];
  nodes: Record<string, NodeSimState>;
  edges: Record<string, EdgeSimState>;
  /** Most recent events, newest last, capped (~200). */
  events: SimEvent[];
  /** Request routing: sampled counts per route id (only when the diagram has request routes). */
  routes?: Record<string, RouteCounts>;
  /** Messages alive anywhere in the system (travelling, queued or in process). */
  inSystem: number;
}

/** Sampled counts for one request route: sent by sources and callers, refused by routers, finished. */
export interface RouteCounts {
  sent: number;
  rejected: number;
  completed: number;
}

/** Per-node tunables. Read from DiagramNode.props on load; can be changed live via setNodeProps. */
export interface NodeSimProps {
  resources?: import("../model/autoscaling").ComputeResources;
  autoscaling?: import("../model/autoscaling").AutoscalingConfig;
  /** An authored replicas patch suspends HPA until this is explicitly true. */
  resumeAutoscaling?: boolean;
  api?: import("../model/admission").ApiBehaviour;
  endpoints?: import("../model/admission").ApiEndpoint[];
  scaling?: "fixed" | "auto";
  maxConcurrency?: number;
  /** Immutable lesson/device preset and its revision; behaviour-critical values are pinned alongside. */
  preset?: string;
  presetRevision?: string;
  /** Store connection ceiling, separate from concurrent queries. Reserved contract; not enforced in P1. */
  connections?: number;
  /** Measured active-query slots. Reserved contract; stores remain parallel in P1 playback. */
  querySlots?: number;
  /** Broker provisioning metadata, in its profile's ingest unit; no hard ingest ceiling in P2. */
  ingestUnits?: number;
  /** Sources: real messages / second when traffic is on. Default 2. */
  ratePerSec?: number;
  /** Processors / gateways / stores: per-message processing time in ms, never scaled. Defaults by role. */
  latencyMs?: number;
  /** Processors: parallel messages per replica. Default 4. */
  concurrency?: number;
  /** Processors: instances (pods). Effective parallelism = replicas × concurrency. Behind a partitioned log,
   *  at most `partitions` instances per group work; P2 subscriptions/bindings use the full fleet. Default 1. */
  replicas?: number;
  /** 0..1 random spread applied to latencyMs (0.3 ⇒ ±30%). Default 0.2. */
  jitter?: number;
  /** Processors: probability 0..1 that processing a message fails. Default 0. */
  failureRate?: number;
  /** Broker deliveries: requeue (default) or hold the slot and retry in place. */
  retry?: "requeue" | "inplace";
  retryBackoffMs?: number;
  /** Brokers (topic/queue/stream): deliveries before dead-lettering. Default 3. */
  maxDeliveryCount?: number;
  /** Partitioned logs: available instance assignments per group (Kinesis shards). Default 3. P2 subscription/binding fan-out ignores it; legacy/p1 retain role-based limits. */
  partitions?: number;
  /** Message type emitted by sources / injection. Default derived from node label. */
  messageType?: string;
  /** Processors: the message type sent downstream. A string renames every message; a map renames by
   *  incoming type ("*" = fallback). Default: unchanged. E.g. { "MemberJoined": "WelcomeEmailRequested" }. */
  emits?: string | Record<string, string>;
  // Network devices (src/stencils/netDevices.ts): gateways with a throughput ceiling. Their stencil's size preset
  // supplies the defaults; any gateway with an explicit `gbps` gets the ceiling too.
  /** Network devices: the size preset (branch, campus or data centre) the defaults come from. */
  size?: "branch" | "campus" | "datacentre";
  /** Network devices: throughput per unit in Gbps (the datasheet figure). Default: the size preset's. */
  gbps?: number;
  /** Average payload in kB (1,000 bytes). Devices convert throughput with it (default 64); brokers retain it as producer metadata only, with no default or ingest enforcement. */
  messageKB?: number;
  /** Network devices: standalone (default), an active-standby pair or an active-active cluster of `replicas` units. */
  ha?: "standalone" | "active-standby" | "active-active";
  /** Network devices: how long an active-standby pair stalls when a unit fails, ms. Default 1000. */
  failoverMs?: number;
  /** Gateways: skip targets that are down (default on for ADCs, off elsewhere). */
  healthChecks?: boolean;
  /** Sources: the request routes they send and in what proportions or rates (request routing R1). */
  trafficMix?: import("../model/requestRouting").TrafficMix;
  /** HTTP routers: ordered rules choosing an outgoing connection by method, path and host (request routing R1). */
  routeTable?: import("../model/requestRouting").RouteTable;
}

/** Per-edge tunables from DiagramEdge.props. */
export interface EdgeSimProps {
  endpointId?: string;
  caller?: {
    wait?: "blocking" | "non-blocking";
    replyMs?: number;
    deadlineMs?: number | null;
    retry?: import("../model/admission").RetryPolicy;
    poolConnections?: number;
  };
  /** Log consumer group, pub/sub subscription or exchange binding name. Each name receives a copy; readers sharing a name compete. Queues always compete; DLQ routes never subscribe. Default = edge id. */
  group?: string;
  /** Inferred groups follow the consumer id when a connection is copied or reconnected. */
  groupOrigin?: "inferred";
  /** Independent probability for a source/processor/store fan-out copy. Default 1. */
  share?: number;
  /** Marks this edge as the dead-letter path of its source broker. Also inferred when the target
   *  node's label/sublabel matches /dlq|dead.?letter/i on broker-to-broker/store edges. False opts out. */
  dlq?: boolean;
  /** Legacy transit/animation time at 1x. Default 300 (async) / 200 (sync); not physical network latency. */
  travelMs?: number;
  /** Physical one-way delay in ms, unknown when absent. Planning metadata only in P1; never adds to travelMs. */
  networkDelayMs?: number;
  /** Only these message types travel this edge (subscription filter). Supports a trailing "*" wildcard,
   *  e.g. ["Order*"]. Messages matching no outgoing edge of a broker group are simply not delivered to it. */
  filter?: string[];
  /** Rename messages as they leave along this edge (overrides the source node's `emits`). */
  emits?: string;
  /** A deny rule: messages routed here are blocked at the edge's source (counted as blocked, never dropped). */
  deny?: boolean;
  /** A Request out of a source or service: the request route this call sends (an explicit caller address). */
  requestRouteId?: string;
  /** Only requests whose address matches travel this connection (a binding's routing key or header match). */
  requestFilter?: import("../model/requestRouting").RouteMatch;
}

export interface InjectOptions {
  /** Message type label. Default = node's messageType. */
  type?: string;
  /** Spread the injection over this many ms instead of all at once. Default 0. */
  spreadMs?: number;
  /** An explicit request route for every injected message; omitted, a source with a traffic mix uses its mix. */
  routeId?: string;
}

// ---------- Message trace (src/sim/lineage.ts) ----------
// A message's lineage: every hop it and its fan-out copies took, with times. Recorded only for the
// followed message and a bounded history of recent ones, so memory stays capped.

export type TraceStepKind =
  | "emit" // the root message was created (injection or source traffic) at `node`
  | "copy" // a fan-out copy `id` of `parent` was made at `node` (it leaves on its own edge)
  | "send" // left `node` along `edge` as a `via` particle, arriving at `until`
  | "arrive" // reached `node` along `edge`
  | "start" // `node` began processing it (after any wait in its backlog)
  | "done" // `node` finished it (a broker appended it to its log)
  | "fail" // `node` failed attempt `attempt`
  | "retry" // broker `node` will redeliver it (delivery `attempt` failed)
  | "deadletter" // broker `node` gave up after `attempt` deliveries and sent it to its DLQ edge
  | "drop" // lost at `node` (down, no route); `reason` says why
  | "block" // stopped at `node` by a deny rule on its way out: on purpose, never a loss
  | "reject" // refused admission: no processing attempt, retry or caller cascade
  | "park" // kept at `node`: a broker with no consumers (a dead-letter queue)
  | "end"; // consumed at `node` (a sink, a store, a final worker)

export interface TraceStep {
  /** Call retry beat; broker delivery attempts keep their existing fields. */
  backoffMs?: number;
  maxAttempts?: number;
  /** Simulation time in ms. */
  t: number;
  kind: TraceStepKind;
  /** The message or copy this step is about. */
  id: number;
  /** Its type at this step (renames show up as a change between steps). */
  type: string;
  node?: string;
  edge?: string;
  /** send: why it's travelling. */
  via?: ParticleKind;
  /** send: when it arrives at the other end. */
  until?: number;
  /** copy: the message it was copied from. */
  parent?: number;
  /** fail / retry / deadletter: the delivery attempt (1-based). */
  attempt?: number;
  /** drop / end: a short reason. */
  reason?: string;
  /** Request routing: the address's route id, on every step of an addressed message. */
  route?: string;
  /** A router's choice (on its send) or refusal (on reject): the matched rule id, or "default". */
  rule?: string;
  /** The chosen target's share of its rule's eligible weights, 0..1 (on a router's send). */
  weight?: number;
}

export interface MessageTrace {
  rootId: number;
  /** The root's type when it was created. */
  type: string;
  /** Where the root was created (or first seen, for a partial trace). */
  origin: string;
  startedAt: number;
  /** When the last copy finished (consumed, dropped or parked); undefined while in flight. */
  endedAt?: number;
  done: boolean;
  /** Recording began after the message was created (its earlier hops are unknown). */
  partial: boolean;
  /** The step cap was reached; later steps are missing. */
  truncated: boolean;
  steps: TraceStep[];
}

/** Enough about a recorded journey to choose one (the slowest, one that dead-lettered). */
export interface TraceSummary {
  rootId: number;
  type: string;
  origin: string;
  startedAt: number;
  endedAt?: number;
  done: boolean;
  partial: boolean;
  retries: number;
  deadLettered: boolean;
  /** When it (or its latest copy to do so) was dead-lettered, simulation ms. Set when `deadLettered`. */
  deadLetteredAt?: number;
  dropped: boolean;
  /** A deny rule stopped it (or a copy): on purpose, not a loss. */
  blocked: boolean;
  rejected?: boolean;
}

/** What the tracer is waiting for: the next message at a node (or anywhere), or the next dead letter. */
export type TraceRequest = { next: "message"; node?: string } | { next: "deadletter" };

export interface MessageTracer {
  /** Keep the lineage of up to `count` recent messages (0: only the followed one). Survives load(). */
  setHistory(count: number): void;
  /** Follow the message (or copy) with this id. Returns its root id, or undefined if it isn't alive. */
  follow(messageId: number): number | undefined;
  /** Follow a root by id: now if it's recorded or alive, otherwise as soon as it's created. */
  followRoot(rootId: number): void;
  /** Follow the next message to arrive at (or start from) a node, or the next one to dead-letter. */
  request(next: TraceRequest): void;
  /** Stop following and forget any pending request. */
  clear(): void;
  /** The followed root id, if any. */
  followed(): number | undefined;
  /** The pending request, if any. */
  pending(): TraceRequest | undefined;
  /** A detached copy of the followed message's trace. */
  current(): MessageTrace | undefined;
  /** A detached copy of a recorded trace. */
  get(rootId: number): MessageTrace | undefined;
  /** Summaries of every recorded trace, oldest first. */
  recent(): TraceSummary[];
}

/** Opaque, in-memory checkpoint. Only the engine that captured it can restore it. */
export interface EngineCheckpoint {
  readonly time: number;
}

export interface SimEngine {
  /** Sampled calls waiting for a connection, read without changing playback or its snapshot format. */
  queuedCalls(edgeId: string): number;
  /**
   * The replica range a scaled node's policy allows now (its controller at the run's current Capacity ×, after any
   * patch), read without changing playback or its snapshot format; undefined when autoscaling is off.
   */
  replicaBounds(nodeId: string): { min: number; max: number; multiplier: number } | undefined;
  /** Sampled terminal losses caused by the named timeout edges, including propagated failures. */
  timeoutLosses(edges: ReadonlySet<string>): Record<string, number>;
  /** Message lineage: follow one message and its copies hop by hop. Its state is part of checkpoints. */
  readonly tracer: MessageTracer;
  replicaPage(nodeId: string, page?: number): import("./autoscaling").ReplicaRow[];
  /** A resource-enabled node's fleet counts and latest decision, without copying other state. */
  fleet(nodeId: string): import("./autoscaling").FleetReadout | undefined;
  /** Sampled thread counts without constructing a frame or traversing waiting calls. */
  threadUsage(nodeId: string): { working: number; waiting: number } | undefined;
  checkpoint(): EngineCheckpoint;
  restore(checkpoint: EngineCheckpoint): void;
  /** Detached raw properties currently used by the engine, including runtime overrides. */
  effectiveProps(nodeId: string): Record<string, unknown>;
  /** Immutable raw configuration snapshot, stable until a property change, load or restore. */
  configuration(): Record<string, Record<string, unknown>>;
  /** Clock in ms; inSystem is sampled, pendingInjections counts scheduled batches (never scale it). */
  metrics(): { time: number; inSystem: number; pendingInjections: number };
  /** Read a sampled metric without copying node or rendering state. Runner expectations convert it. */
  measure(metric: Expectation["metric"]): number | undefined;
  /** Replace the diagram being simulated. Resets all state. */
  load(diagram: DiagramFile): void;
  /** Advance the simulation by dtMs of wall time (multiplied by speed). Internally fixed-step. */
  step(dtMs: number): void;
  /** Full inspection state, including a detached copy of the recent event log. */
  snapshot(): SimSnapshot;
  /** Detached rendering state without edge counters or event-log copies. */
  frame(): SimFrame;
  /** Sampling weight, used by the runner; direct inject still takes simulated counts. */
  setScale(scale: number): void;
  /** Capacity multiplier changes replicas without overwriting base node props. */
  setCapacityMultiplier(multiplier: number): void;
  /** Inject `count` sampled messages. For real counts use SimulationRun.inject. */
  inject(nodeId: string, count: number, opts?: InjectOptions): void;
  setFault(fault: import("../model/faults").Fault): void;
  /** Drills discard latency samples on each effective fault change; Free play stays cumulative. */
  setLatencySinceFault(on: boolean): void;
  setNodeStatus(nodeId: string, status: NodeStatus): void;
  setNodeProps(nodeId: string, patch: NodeSimProps): void;
  /** Preflight ordered lifecycle edits without copying or mutating playback state. */
  validateLifecycleActions(actions: readonly { node: string; props: NodeSimProps }[]): void;
  /** Apply patches and an optional capacity multiplier with one incremental allocation pass. */
  setNodePropsBatch(patches: Record<string, NodeSimProps>, capacityMultiplier?: number): void;
  /** Continuous sources are disabled when their sampled rate or per-run volume exceeds the safety budget. */
  trafficLimit(): "rate" | "volume" | "resources" | undefined;
  /** Continuous traffic from every source node at its ratePerSec, subject to trafficLimit(). */
  setTraffic(on: boolean): void;
  /** Time multiplier (0.25 – 8). Default 1. */
  setSpeed(speed: number): void;
  /** Clear all messages and counters, keep the diagram and node statuses/props. */
  reset(): void;
}

export interface EngineOptions {
  onLoss?: (loss: LossProvenance) => void;
  /** Optional per-step diagnostic; excluded from ordinary playback. */
  verifyResources?: (state: import("./resourceInvariants").ResourceState) => void;
  verifyLedger?: (state: import("./resourceInvariants").LedgerInvariantState) => void;
  /** Per-step write-once attempt diagnostic; excluded from ordinary playback. */
  verifyResilience?: (state: import("./resilienceInvariants").ResilienceState) => void;
  verifyOutcomes?: (state: import("./resourceInvariants").OutcomeInvariantState) => void;
  /** Test-only I7 probe: release sampled holds at logical completion. */
  ledgerHold?: "none";
  /** Test-only partial dots: every injected message carries this many real requests. */
  injectRepresented?: number;
  /** PRNG seed for deterministic runs (tests). Default random. */
  seed?: number;
  /** Resolve a stencil id to its sim role. Default uses the stencil registry. */
  roleOf?: (stencilId: string) => SimRole;
  /** Hard cap on live particles; beyond it messages still flow but aren't drawn. Default 1500. */
  maxParticles?: number;
  scale?: number;
  /** Message trace: keep the lineage of this many recent messages (MessageTracer.setHistory). Default 0. */
  traceHistory?: number;
  /** Headless planning: messages (sent and copied) this engine may still create, shared across runs. Creating one
   *  past zero throws WorkBudgetError before anything is allocated. Default: unbounded (playback). */
  messageBudget?: { remaining: number };
}

// ---------- Simulation runner (src/sim/simulation.ts) ----------
// Plays a saved Simulation (src/model/types.ts) on top of an engine: traffic profiles, timeline
// actions, narration notes and live expectations. Pure and deterministic like the engine.

export type ExpectationStatus = "pending" | "pass" | "fail";

export interface ExpectationState {
  id: string;
  label: string;
  status: ExpectationStatus;
  /** Latest measured value in real message units (counts or messages/s). */
  value: number;
}

export interface TimelineMarker {
  atMs: number;
  kind: "note" | "status" | "props" | "inject" | "trace" | "traffic" | "fault";
  label: string;
}

export interface SimulationRunState {
  /** Simulation time in ms since the run started. */
  time: number;
  /** Estimated total length in ms (durationMs, or traffic/timeline end + drain allowance). */
  totalMs: number;
  done: boolean;
  /** True while a pausing note is waiting for resume(). */
  waiting: boolean;
  /** The latest note reached (stays visible until the next note or 6 s pass). */
  note?: { text: string; focus: string[]; atMs: number };
  expectations: ExpectationState[];
  /** Static markers for drawing the timeline (computed once per load). */
  markers: TimelineMarker[];
  scale?: number;
  multipliers?: { traffic: number; capacity: number };
}

/** Opaque full-run checkpoint, owned by one runner and invalidated by restart. */
export interface SimulationRunCheckpoint {
  readonly time: number;
}

export interface SimulationRun {
  checkpoint(): SimulationRunCheckpoint;
  restore(checkpoint: SimulationRunCheckpoint): void;
  /** Low-level engine: all message metrics and direct injections use sampled units. */
  readonly engine: SimEngine;
  readonly units: SimulationUnits;
  /** Inject a real message count, divided by scale; fractional credit is retained per node/type.
   * Manual injection is independent of the traffic multiplier. Restart clears its credits. */
  inject(nodeId: string, count: number, opts?: InjectOptions): void;
  /** Inject the real count independently at every source, using each source's default type. */
  injectAtSources(count: number, opts?: InjectOptions): void;
  /** Advance by dtMs of wall time (engine speed applies). No-op while waiting on a note or done. */
  step(dtMs: number): void;
  /** Update both the runner clock and engine without replacing caller-owned methods. */
  setSpeed(speed: number): void;
  state(): SimulationRunState;
  /** Partial live patch; restart restores saved multipliers. */
  setMultipliers(patch: { traffic?: number; capacity?: number }): void;
  /** Continue after a pausing note. */
  resume(): void;
  /** Start over from t=0 with the same seed. */
  restart(): void;
  /**
   * Timeline trace actions retarget the engine's tracer (on by default). Slow motion's look-ahead
   * turns them off while it follows its own message.
   */
  setTraceActions(on: boolean): void;
}

export interface SimulationRunOptions extends EngineOptions {
  /** Reuse an existing engine (it is re-loaded with the diagram); otherwise one is created. */
  engine?: SimEngine;
}
