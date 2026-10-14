// Public contract for the simulation engine. The engine (src/sim/engine.ts) is pure TypeScript —
// no DOM, no React — so it can be unit-tested deterministically. The UI drives it with step(dt)
// from requestAnimationFrame and renders frame() each frame. Semantics: docs/SIMULATION.md.

import type { DiagramFile, Expectation, SimRole } from "../model/types";

export type NodeStatus = "up" | "paused" | "down";

/** Why a particle is travelling along an edge. Drives its colour / style in the UI. */
export type ParticleKind =
  | "message" // a message (or request) moving downstream
  | "reply" // response travelling back along a sync edge
  | "retry" // a failed delivery travelling back to its broker for redelivery
  | "dlq"; // a message being dead-lettered

export interface Particle {
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
  /** Hex colour for the particle (from the message type). */
  color: string;
}

/** Native engine message counts and rates are sampled units; time and replica counts are unscaled. */
export interface NodeSimState {
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
  /** An active-standby pair is failing over to its standby unit: traffic waits until it's done. */
  failingOver?: boolean;
  /** Smoothed throughput in messages / second (processed). */
  throughput: number;
  /** Configured and partition-assigned instances (not current busy counts). */
  replicas?: number;
  activeReplicas?: number;
  idleReplicas?: number;
}

export interface EdgeSimState {
  id: string;
  /** Total messages that have finished travelling this edge. */
  delivered: number;
  /** Sampled trips currently on this edge, including visual replies. */
  active: number;
}

export type SimEventKind =
  "inject" | "deliver" | "process" | "fail" | "retry" | "deadletter" | "drop" | "block" | "status";

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

export type SimFrame = Pick<SimSnapshot, "time" | "particles" | "nodes" | "inSystem" | "scale">;

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
  /** Real messages per simulated message. Default 1. */
  scale?: number;
  /** Simulation clock in ms (scaled by speed). */
  time: number;
  particles: Particle[];
  nodes: Record<string, NodeSimState>;
  edges: Record<string, EdgeSimState>;
  /** Most recent events, newest last, capped (~200). */
  events: SimEvent[];
  /** Messages alive anywhere in the system (travelling, queued or in process). */
  inSystem: number;
}

/** Per-node tunables. Read from DiagramNode.props on load; can be changed live via setNodeProps. */
export interface NodeSimProps {
  /** Sources: real messages / second when traffic is on. Default 2. */
  ratePerSec?: number;
  /** Processors / gateways / stores: per-message processing time in ms, never scaled. Defaults by role. */
  latencyMs?: number;
  /** Processors: parallel messages per replica. Default 4. */
  concurrency?: number;
  /** Processors: instances (pods). Effective parallelism = replicas × concurrency. Behind a topic or
   *  stream, at most `partitions` replicas per consumer group do work; the rest are idle. Default 1. */
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
  /** Topics / streams: available replica assignments per consumer group. Default 3. */
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
  /** Network devices: the average message in kB (1,000 bytes) the throughput is converted with. Default 64. */
  messageKB?: number;
  /** Network devices: standalone (default), an active-standby pair or an active-active cluster of `replicas` units. */
  ha?: "standalone" | "active-standby" | "active-active";
  /** Network devices: how long an active-standby pair stalls when a unit fails, ms. Default 1000. */
  failoverMs?: number;
  /** Gateways: skip targets that are down (default on for ADCs, off elsewhere). */
  healthChecks?: boolean;
}

/** Per-edge tunables from DiagramEdge.props. */
export interface EdgeSimProps {
  /** Consumer group for edges leaving a topic/stream. Edges sharing a group compete; default = edge id. */
  group?: string;
  /** Independent probability for a source/processor/store fan-out copy. Default 1. */
  share?: number;
  /** Marks this edge as the dead-letter path of its source broker. Also inferred when the target
   *  node's label/sublabel matches /dlq|dead.?letter/i on broker-to-broker/store edges. False opts out. */
  dlq?: boolean;
  /** Travel time in ms at 1x speed. Default 300 (async) / 200 (sync), `DEFAULT_TRAVEL_MS` in topology.ts. */
  travelMs?: number;
  /** Only these message types travel this edge (subscription filter). Supports a trailing "*" wildcard,
   *  e.g. ["Order*"]. Messages matching no outgoing edge of a broker group are simply not delivered to it. */
  filter?: string[];
  /** Rename messages as they leave along this edge (overrides the source node's `emits`). */
  emits?: string;
  /** A deny rule: messages routed here are blocked at the edge's source (counted as blocked, never dropped). */
  deny?: boolean;
}

export interface InjectOptions {
  /** Message type label. Default = node's messageType. */
  type?: string;
  /** Spread the injection over this many ms instead of all at once. Default 0. */
  spreadMs?: number;
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
  | "park" // kept at `node`: a broker with no consumers (a dead-letter queue)
  | "end"; // consumed at `node` (a sink, a store, a final worker)

export interface TraceStep {
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
  /** Message lineage: follow one message and its copies hop by hop. Its state is part of checkpoints. */
  readonly tracer: MessageTracer;
  checkpoint(): EngineCheckpoint;
  restore(checkpoint: EngineCheckpoint): void;
  /** Detached raw properties currently used by the engine, including runtime overrides. */
  effectiveProps(nodeId: string): Record<string, unknown>;
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
  setNodeStatus(nodeId: string, status: NodeStatus): void;
  setNodeProps(nodeId: string, patch: NodeSimProps): void;
  /** Apply patches and an optional capacity multiplier with one incremental allocation pass. */
  setNodePropsBatch(patches: Record<string, NodeSimProps>, capacityMultiplier?: number): void;
  /** Continuous sources are disabled when their sampled rate or per-run volume exceeds the safety budget. */
  trafficLimit(): "rate" | "volume" | undefined;
  /** Continuous traffic from every source node at its ratePerSec, subject to trafficLimit(). */
  setTraffic(on: boolean): void;
  /** Time multiplier (0.25 – 8). Default 1. */
  setSpeed(speed: number): void;
  /** Clear all messages and counters, keep the diagram and node statuses/props. */
  reset(): void;
}

export interface EngineOptions {
  /** PRNG seed for deterministic runs (tests). Default random. */
  seed?: number;
  /** Resolve a stencil id to its sim role. Default uses the stencil registry. */
  roleOf?: (stencilId: string) => SimRole;
  /** Hard cap on live particles; beyond it messages still flow but aren't drawn. Default 1500. */
  maxParticles?: number;
  scale?: number;
  /** Message trace: keep the lineage of this many recent messages (MessageTracer.setHistory). Default 0. */
  traceHistory?: number;
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
  kind: "note" | "status" | "props" | "inject" | "trace" | "traffic";
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
