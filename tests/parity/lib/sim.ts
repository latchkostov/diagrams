// Plays a diagram exactly as the live view does (src/live/LiveSession.tsx: `new LiveController(diagram)`, then
// a saved simulation selected, or free play with traffic on) and records what it produced: the run state, the
// counters per node every 10 simulated seconds, the full event stream (as a hash per simulated second) and
// latency statistics from the message tracer. docs/PARITY.md.

import type { DiagramFile, Simulation } from "../../../src/model/types";
import { observeEngineEvents } from "../../../src/sim/engine";
import { LiveController } from "../../../src/live/controller";
import type { MessageTrace, NodeSimState, SimEngine, SimEvent, SimSnapshot } from "../../../src/sim/types";
import { sha256 } from "./hash";

/** One engine tick (src/sim/engine.ts STEP): the harness reads the event log after every tick. */
const TICK_MS = 10;
const CHECKPOINT_MS = 10_000;
/** Free play is open-ended: it plays this long. */
export const FREE_PLAY_MS = 60_000;
/** A saved simulation always ends by 600 s (docs/SIMULATION.md); a backstop against a hang. */
const MAX_RUN_MS = 600_000;

/** The counters of one node, leaving out zeros and defaults so the record stays short. */
function counters(node: NodeSimState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.status !== "up") out.status = node.status;
  for (const key of [
    "processed",
    "failed",
    "dropped",
    "outageDropped",
    "blocked",
    "rejected",
    "shed",
    "shedLost",
    "queueDepth",
    "queueLimit",
    "deadLettered",
    "backlog",
    "inFlight",
    "throughput",
  ] as const) {
    const value = node[key];
    // Zero and absent are left out; anything else is kept, NaN included (it must not read as zero).
    if (value !== 0 && value !== undefined) out[key] = value;
  }
  if (Object.keys(node.lag).length) out.lag = { ...node.lag };
  // P3 admission refusals by reason (rate, concurrency, tokens…), beside the rejected count.
  if (node.rejectionReasons && Object.keys(node.rejectionReasons).length)
    out.rejectionReasons = { ...node.rejectionReasons };
  if (node.noConsumer) out.noConsumer = true;
  if (node.failingOver) out.failingOver = true;
  if (node.replicas !== undefined)
    out.replicas = [node.replicas, node.activeReplicas ?? null, node.idleReplicas ?? null];
  return out;
}

function nodeCounters(snapshot: SimSnapshot, order: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(order.map((id) => [id, snapshot.nodes[id] ? counters(snapshot.nodes[id]) : "(missing)"]));
}

const eventKey = (e: SimEvent) => `${e.time}|${e.kind}|${e.nodeId}|${e.messageId ?? ""}|${e.text}`;

interface Stat {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  max: number;
}

function stat(values: number[]): Stat | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    p50: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
  };
}

/** Latencies from the finished journeys the tracer kept (the live view's history: TRACE_HISTORY). */
class Latencies {
  private seen = new Set<number>();
  private endToEnd: number[] = [];
  private wait = new Map<string, number[]>();
  private work = new Map<string, number[]>();
  private outcomes: Record<string, number> = {
    done: 0,
    retried: 0,
    deadLettered: 0,
    dropped: 0,
    blocked: 0,
    partial: 0,
    truncated: 0,
  };

  read(engine: SimEngine): void {
    for (const summary of engine.tracer.recent()) {
      if (!summary.done || this.seen.has(summary.rootId)) continue;
      this.seen.add(summary.rootId);
      const trace = engine.tracer.get(summary.rootId);
      if (trace) this.add(trace, summary);
    }
  }

  private add(trace: MessageTrace, summary: ReturnType<SimEngine["tracer"]["recent"]>[number]): void {
    const o = this.outcomes;
    o.done++;
    if (summary.retries) o.retried++;
    if (summary.deadLettered) o.deadLettered++;
    if (summary.dropped) o.dropped++;
    if (summary.blocked) o.blocked++;
    // Refused admission (P3): recorded only when it happens, so earlier goldens keep their shape.
    if (summary.rejected) o.rejected = (o.rejected ?? 0) + 1;
    if (trace.partial) o.partial++;
    if (trace.truncated) o.truncated++;
    if (trace.endedAt !== undefined) this.endToEnd.push(trace.endedAt - trace.startedAt);
    const arrived = new Map<string, number>();
    const started = new Map<string, number>();
    for (const step of trace.steps) {
      const key = `${step.id}@${step.node}`;
      // A message waits from when it arrives, or, at its origin, from when it's created there.
      if (step.kind === "arrive" || step.kind === "emit") arrived.set(key, step.t);
      else if (step.kind === "start" && step.node) {
        started.set(key, step.t);
        const at = arrived.get(key);
        if (at !== undefined) push(this.wait, step.node, step.t - at);
      } else if (step.kind === "done" && step.node) {
        const at = started.get(key);
        if (at !== undefined) push(this.work, step.node, step.t - at);
      }
    }
  }

  result(order: readonly string[]) {
    const perNode = (m: Map<string, number[]>) =>
      Object.fromEntries(order.flatMap((id) => (m.has(id) ? [[id, stat(m.get(id) ?? [])]] : [])));
    return {
      journeys: this.outcomes,
      endToEndMs: stat(this.endToEnd) ?? null,
      waitMs: perNode(this.wait),
      processMs: perNode(this.work),
    };
  }
}

function push(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The engine behind the controller, for its tracer. Fails loudly if the controller's shape changes. */
function engineOf(controller: LiveController): SimEngine {
  const engine = (controller as unknown as { engine?: SimEngine }).engine;
  if (!engine?.tracer) throw new Error("parity: LiveController no longer has an `engine` field; update tests/parity");
  return engine;
}

export interface PlayRecord {
  run: unknown;
  checkpoints: { atMs: number; inSystem: number; nodes: Record<string, unknown> }[];
  final: {
    atMs: number;
    inSystem: number;
    /** Real units, as the live view shows them. */
    real: Record<string, unknown>;
    edges: Record<string, number>;
  };
  events: {
    total: number;
    byKind: Record<string, number>;
    byNode: Record<string, Record<string, number>>;
    /** SHA-256 (first 12 hex digits) of each simulated second's events, in order; "-" for a quiet second. */
    perSecond: string[];
  };
  notes: { atMs: number; text: string; focus: string[] }[];
  latency: ReturnType<Latencies["result"]>;
}

/** Plays a saved simulation to its end, or free play for FREE_PLAY_MS, as the live view does. */
export function play(diagram: DiagramFile, simulation: Simulation | null): PlayRecord {
  const controller = new LiveController(diagram);
  if (simulation) controller.selectSimulation(simulation);
  else controller.setTraffic(true);
  controller.setPlaying(true);
  const engine = engineOf(controller);
  const order = diagram.nodes.map((n) => n.id);
  const latencies = new Latencies();
  const checkpoints: PlayRecord["checkpoints"] = [];
  const notes: PlayRecord["notes"] = [];
  const byKind: Record<string, number> = {};
  const byNode: Record<string, Record<string, number>> = {};
  const perSecond: string[] = [];
  let bucket: string[] = [];
  let bucketSecond = 0;
  let total = 0;
  let first = true;
  const pendingEvents: SimEvent[] = [];
  const stopObserving = observeEngineEvents(engine, (event) => pendingEvents.push(event));
  const flush = (upTo: number) => {
    while (bucketSecond < upTo) {
      perSecond.push(bucket.length ? sha256(bucket.join("\n")).slice(0, 12) : "-");
      bucket = [];
      bucketSecond++;
    }
  };
  const readEvents = (snapshot: SimSnapshot) => {
    const added = first ? snapshot.events : pendingEvents.splice(0);
    first = false;
    for (const event of added) {
      const key = eventKey(event);
      flush(Math.floor(event.time / 1000));
      bucket.push(key);
      total++;
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
      const node = (byNode[event.nodeId] ??= {});
      node[event.kind] = (node[event.kind] ?? 0) + 1;
    }
  };

  let snapshot = controller.snapshot();
  readEvents(snapshot);
  let nextCheckpoint = 0;
  let lastNote: string | undefined;
  for (;;) {
    const run = controller.getState().run;
    if (snapshot.time >= nextCheckpoint) {
      checkpoints.push({ atMs: snapshot.time, inSystem: snapshot.inSystem, nodes: nodeCounters(snapshot, order) });
      nextCheckpoint += CHECKPOINT_MS;
    }
    const note = run?.note;
    const noteKey = note && JSON.stringify(note);
    if (note && noteKey !== lastNote) notes.push({ atMs: note.atMs, text: note.text, focus: note.focus });
    lastNote = noteKey;
    if (simulation ? run?.done : snapshot.time >= FREE_PLAY_MS) break;
    if (snapshot.time >= MAX_RUN_MS) throw new Error(`still running after ${MAX_RUN_MS} ms`);
    if (run?.waiting) controller.resume();
    const before = snapshot.time;
    // The live view's clock: advance, then publish (which refreshes the run state).
    controller.advance(TICK_MS);
    controller.publish();
    snapshot = controller.snapshot();
    if (snapshot.time === before && !controller.getState().run?.waiting && !controller.getState().run?.done)
      throw new Error(`the clock stopped at ${before} ms`);
    readEvents(snapshot);
    if (snapshot.time % 100 === 0) latencies.read(engine);
  }
  latencies.read(engine);
  flush(Math.floor(snapshot.time / 1000) + 1);
  const state = controller.getState();
  const real = controller.realSnapshot();
  stopObserving();
  controller.dispose();
  return {
    run: state.run
      ? {
          time: state.run.time,
          totalMs: state.run.totalMs,
          done: state.run.done,
          scale: state.run.scale ?? null,
          multipliers: state.run.multipliers ?? null,
          expectations: state.run.expectations,
          markers: state.run.markers,
        }
      : { time: snapshot.time, scale: state.scale, traffic: state.traffic },
    checkpoints,
    final: {
      atMs: snapshot.time,
      inSystem: snapshot.inSystem,
      real: nodeCounters(real as unknown as SimSnapshot, order),
      edges: Object.fromEntries(diagram.edges.map((e) => [e.id, snapshot.edges[e.id]?.delivered ?? 0])),
    },
    events: { total, byKind, byNode, perSecond },
    notes,
    latency: latencies.result(order),
  };
}
