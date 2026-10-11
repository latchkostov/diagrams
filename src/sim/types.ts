// Public contract for the simulation engine. The engine (src/sim/engine.ts) is pure TypeScript —
// no DOM, no React — so it can be unit-tested deterministically. The UI drives it with step(dt)
// from requestAnimationFrame and renders snapshot() each frame. Semantics: docs/SIMULATION.md.

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
  kind: ParticleKind;
  /** 0..1 along the edge path. For reply / retry particles the UI draws it target → source. */
  progress: number;
  /** Message type, e.g. "OrderPlaced". */
  type: string;
  /** Hex colour for the particle (from the message type). */
  color: string;
}

export interface NodeSimState {
  id: string;
  role: SimRole;
  status: NodeStatus;
  /** Messages waiting at this node: queue depth for queues, max consumer-group lag for topics/streams,
   *  waiting work for processors. */
  backlog: number;
  /** Per consumer group lag (topics / streams / queues). Key = group name. */
  lag: Record<string, number>;
  /** Messages currently being processed (processors) — at most `concurrency`. */
  inFlight: number;
  /** Total messages successfully handled / stored / emitted. */
  processed: number;
  /** Total processing failures at this node (each failed attempt counts). */
  failed: number;
  /** Messages this node (as a broker) moved to its dead-letter path. */
  deadLettered: number;
  /** Messages dropped because they had nowhere to go (node down, no DLQ, etc.). */
  dropped: number;
  /** Smoothed throughput in messages / second (processed). */
  throughput: number;
}

export interface EdgeSimState {
  id: string;
  /** Total messages that have finished travelling this edge. */
  delivered: number;
  /** Particles currently on this edge. */
  active: number;
}

export type SimEventKind = "inject" | "deliver" | "process" | "fail" | "retry" | "deadletter" | "drop" | "status";

export interface SimEvent {
  /** Simulation time in ms. */
  time: number;
  kind: SimEventKind;
  nodeId: string;
  messageId?: number;
  /** Human readable, e.g. "payments failed OrderPlaced #42 (attempt 2/3)". */
  text: string;
}

export interface SimSnapshot {
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
  /** Sources: messages / second when traffic is on. Default 2. */
  ratePerSec?: number;
  /** Processors / gateways / stores: processing time per message in ms. Defaults by role. */
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
  /** Brokers (topic/queue/stream): deliveries before dead-lettering. Default 3. */
  maxDeliveryCount?: number;
  /** Topics / streams: max in-flight deliveries per consumer group. Default 3. */
  partitions?: number;
  /** Message type emitted by sources / injection. Default derived from node label. */
  messageType?: string;
  /** Processors: the message type sent downstream. A string renames every message; a map renames by
   *  incoming type ("*" = fallback). Default: unchanged. E.g. { "MemberJoined": "WelcomeEmailRequested" }. */
  emits?: string | Record<string, string>;
}

/** Per-edge tunables from DiagramEdge.props. */
export interface EdgeSimProps {
  /** Consumer group for edges leaving a topic/stream. Edges sharing a group compete; default = edge id. */
  group?: string;
  /** Marks this edge as the dead-letter path of its source broker. Also inferred when the target
   *  node's label/sublabel matches /dlq|dead.?letter/i. */
  dlq?: boolean;
  /** Travel time in ms at 1x speed. Default 900 (async) / 450 (sync). */
  travelMs?: number;
  /** Only these message types travel this edge (subscription filter). Supports a trailing "*" wildcard,
   *  e.g. ["Order*"]. Messages matching no outgoing edge of a broker group are simply not delivered to it. */
  filter?: string[];
  /** Rename messages as they leave along this edge (overrides the source node's `emits`). */
  emits?: string;
}

export interface InjectOptions {
  /** Message type label. Default = node's messageType. */
  type?: string;
  /** Spread the injection over this many ms instead of all at once. Default 0. */
  spreadMs?: number;
}

export interface SimEngine {
  /** Clock and completion counters without rendering allocations. */
  metrics(): { time: number; inSystem: number; pendingInjections: number };
  /** Read just the metric an expectation needs, without copying node or rendering state. */
  measure(metric: Expectation["metric"]): number | undefined;
  /** Replace the diagram being simulated. Resets all state. */
  load(diagram: DiagramFile): void;
  /** Advance the simulation by dtMs of wall time (multiplied by speed). Internally fixed-step. */
  step(dtMs: number): void;
  /** Current state for rendering. Cheap enough to call every frame. */
  snapshot(): SimSnapshot;
  /** Inject `count` messages at a node as if it had just produced/received them. */
  inject(nodeId: string, count: number, opts?: InjectOptions): void;
  setNodeStatus(nodeId: string, status: NodeStatus): void;
  setNodeProps(nodeId: string, patch: NodeSimProps): void;
  /** Continuous traffic from every source node at its ratePerSec. */
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
}

// ---------- Simulation runner (src/sim/simulation.ts) ----------
// Plays a saved Simulation (src/model/types.ts) on top of an engine: traffic profiles, timeline
// actions, narration notes and live expectations. Pure and deterministic like the engine.

export type ExpectationStatus = "pending" | "pass" | "fail";

export interface ExpectationState {
  id: string;
  label: string;
  status: ExpectationStatus;
  /** Latest measured value of the metric. */
  value: number;
}

export interface TimelineMarker {
  atMs: number;
  kind: "note" | "status" | "props" | "inject" | "traffic";
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
}

export interface SimulationRun {
  readonly engine: SimEngine;
  /** Advance by dtMs of wall time (engine speed applies). No-op while waiting on a note or done. */
  step(dtMs: number): void;
  /** Update both the runner clock and engine without replacing caller-owned methods. */
  setSpeed(speed: number): void;
  state(): SimulationRunState;
  /** Continue after a pausing note. */
  resume(): void;
  /** Start over from t=0 with the same seed. */
  restart(): void;
}

export interface SimulationRunOptions extends EngineOptions {
  /** Reuse an existing engine (it is re-loaded with the diagram); otherwise one is created. */
  engine?: SimEngine;
}
