// The live view's model: one engine (free play) or one simulation run (a saved simulation), plus
// the playback state around it. Pure TypeScript with no DOM or React, so it is unit-tested directly.
// The UI drives it from requestAnimationFrame (`advance`) and reads `snapshot()` every frame;
// React components subscribe to `getState()`, which is republished at ~8 Hz while playing.
//
// Units: this is the live UI's conversion boundary. The engine simulates sampled dots (one dot =
// `scale` real messages). `snapshot()` stays sampled for particles and decorations; the published
// `state.snapshot` is converted once to real messages for every number people read, and manual
// injections take real counts (fractions of a dot carry over to the next injection).

import { flowEdges, edgeSemanticSignature } from "../model/relations";
import type { DiagramFile, Simulation } from "../model/types";
import { createRealCountInjector } from "../sim/injection";
import { stencilRole } from "../stencils/roles";
import { createEngine } from "../sim/engine";
import { createSimulationRun } from "../sim/simulation";
import type {
  EngineOptions,
  InjectOptions,
  MessageTrace,
  NodeSimProps,
  NodeStatus,
  RealSimSnapshot,
  SimEngine,
  SimSnapshot,
  SimulationRun,
  SimulationRunState,
  SimulationRunCheckpoint,
  TraceRequest,
} from "../sim/types";
import { realSnapshot, resolveMultiplier, resolveScale } from "../sim/units";
import { autoScale } from "../sim/scale";
import { effectiveSimulation, emptyInputs, freePlayProps, freePlayScale, type LiveInputs } from "./capacityModel";
import { DEFAULT_SEED } from "./storm";

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
/** Sim time one press of "step" advances. */
export const STEP_MS = 250;
/** Recent message journeys kept for "Trace slowest" / "Trace one that dead-lettered" (bounded memory). */
export const TRACE_HISTORY = 160;

/** A live, engine-only change ("Kill", "Slow down ×5"...), kept so it can be saved to the diagram. */
export interface NodeTweak {
  props: NodeSimProps;
  status?: NodeStatus;
}

export interface LiveState {
  playing: boolean;
  speed: number;
  traffic: boolean;
  /** The selected simulation as saved (or the unsaved draft), or null for free play. */
  simulation: Simulation | null;
  /** What actually runs: `simulation` with the Inputs & capacity panel's what-ifs applied. */
  running: Simulation | null;
  /** The panel's what-if inputs (unsaved until "Save"). */
  inputs: LiveInputs;
  /** Real units: counters, rates, backlog and in-flight are real messages, not sampled dots. */
  snapshot: RealSimSnapshot;
  /** Real messages per dot in the running engine. */
  scale: number;
  run: SimulationRunState | null;
  tweaks: ReadonlyMap<string, NodeTweak>;
  /** Bumps whenever the engine is rebuilt (restart, new simulation, structural edit). */
  generation: number;
  /** The message trace: what's followed (its journey so far) or what's awaited. Null when not tracing. */
  trace: LiveTrace | null;
}

export interface LiveTrace {
  /** The followed root message id (its journey may not have started yet after scrubbing back). */
  rootId?: number;
  /** Waiting for the next message at a node (or anywhere), or the next dead letter. */
  pending?: TraceRequest;
  /** A detached copy of the journey so far. */
  current?: MessageTrace;
}

/** A restorable sandbox over the running engine (see `LiveController.lookAhead`). */
export interface LookAhead {
  tracer: SimEngine["tracer"];
  /** Simulation time now, ms. */
  time(): number;
  /** Advance `simMs` of simulated time. False when time can't move (a finished run). */
  step(simMs: number): boolean;
  /** Nothing more can happen (free play with no traffic and an empty system; a finished run). */
  idle(): boolean;
  /** A node's backlog or lag, in real messages. */
  lag(nodeId: string): number | undefined;
  /** Back to the checkpoint, exactly. */
  restore(): void;
}

type TraceIntent = { kind: "idle" } | { kind: "root"; rootId: number } | { kind: "pending"; request: TraceRequest };

export type DiagramUpdate = "none" | "patched" | "reloaded";

/** Changes to these restart the engine; anything else (positions, groups, titles) doesn't touch it. */
export function structuralKey(d: DiagramFile): string {
  return JSON.stringify([
    d.nodes.map((n) => [n.id, n.stencil, n.label, n.sublabel ?? ""]),
    d.edges.map(edgeSemanticSignature),
  ]);
}

// JSON object key order is not a property edit (including nested emission maps).
const valueKey = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const propsKey = (props: Record<string, unknown> | undefined) => valueKey(props ?? {}) ?? "{}";

export interface ControllerOptions extends Pick<EngineOptions, "roleOf" | "maxParticles"> {
  /** Seed for free play; saved simulations use their own. Default 7. */
  seed?: number;
  /** Changes that need a rebuild (entry rates, dot scale) settle for this long first. Default 250; 0 = now. */
  replayDelayMs?: number;
}

/** Same script (traffic, timeline, scale, statuses…), ignoring what can be patched into a running run. */
function sameScript(a: Simulation, b: Simulation): boolean {
  const strip = (s: Simulation) => valueKey({ ...s, multipliers: undefined, setup: { ...s.setup, props: undefined } });
  return strip(a) === strip(b);
}

export class LiveController {
  private diagram: DiagramFile;
  /** What runs: the selected simulation with the panel's inputs applied. */
  private sim: Simulation | null = null;
  /** The selected simulation as saved (or the unsaved draft); null in free play. */
  private base: Simulation | null = null;
  private inputs: LiveInputs = emptyInputs();
  /** Free play: the engine props the inputs currently override, and the dot scale. */
  private freeApplied: Record<string, Record<string, unknown>> = {};
  private freeScale = 1;
  private replayFrame: (() => void) | undefined;
  private replayTarget: number | null = null;
  private replayTimer: ReturnType<typeof setTimeout> | undefined;
  private engine!: SimEngine;
  private runner: SimulationRun | null = null;
  private snap!: SimSnapshot;
  private real: RealSimSnapshot | null = null;
  /** Free play's fractional injection credit per node and type (runs keep their own). */
  private injector!: ReturnType<typeof createRealCountInjector>;
  private checkpoints: SimulationRunCheckpoint[] = [];
  private runState: SimulationRunState | null = null;
  private dirty = true;
  private playing = false;
  /** Slow motion holds live still (see `hold`): play, step, continue and seek wait. */
  private held = false;
  private speed = 1;
  private traffic = false;
  private generation = 0;
  private tweaks = new Map<string, NodeTweak>();
  private listeners = new Set<() => void>();
  private state!: LiveState;
  private structKey: string;
  private nodeProps = new Map<string, string>();

  constructor(
    diagram: DiagramFile,
    private opts: ControllerOptions = {},
  ) {
    this.diagram = diagram;
    this.structKey = structuralKey(diagram);
    this.rememberProps(diagram);
    this.build();
    this.publish();
  }

  // ---------------------------------------------------------------- reading

  /** Latest engine snapshot; recomputed at most once per advance / action. */
  snapshot(): SimSnapshot {
    if (this.dirty) {
      this.snap = this.engine.snapshot();
      this.runState = this.runner?.state() ?? null;
      this.real = null;
      this.dirty = false;
    }
    return this.snap;
  }

  /** The latest snapshot in real units (converted once per change). */
  realSnapshot(): RealSimSnapshot {
    const snap = this.snapshot();
    return (this.real ??= realSnapshot(snap));
  }

  /** Real messages represented by one sampled dot. */
  get scale(): number {
    return resolveScale(this.snapshot().scale);
  }

  getState = (): LiveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Rebuilds the published state and tells subscribers. Called by actions and the UI clock. */
  publish(): void {
    const snapshot = this.realSnapshot();
    this.state = {
      scale: resolveScale(snapshot.scale),
      playing: this.playing,
      speed: this.speed,
      traffic: this.traffic,
      simulation: this.base,
      running: this.sim,
      inputs: this.inputs,
      snapshot,
      run: this.runState,
      tweaks: new Map(this.tweaks),
      generation: this.generation,
      trace: this.readTrace(),
    };
    for (const l of this.listeners) l();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentDiagram(): DiagramFile {
    return this.diagram;
  }

  // ---------------------------------------------------------------- message trace

  /** The followed root message id, read every frame by the particle renderer. */
  get tracedRoot(): number | undefined {
    return this.engine.tracer.followed();
  }

  /** Follow the next message to arrive at (or start from) a node; anywhere when omitted. */
  traceNext(nodeId?: string): void {
    this.engine.tracer.request({ next: "message", node: nodeId });
    this.publish();
  }

  /** Follow a message on screen (a clicked particle). False when it's no longer in the system. */
  traceMessage(messageId: number): boolean {
    const root = this.engine.tracer.follow(messageId);
    this.publish();
    return root !== undefined;
  }

  /** Follow the slowest finished journey still remembered. False when none has finished yet. */
  traceSlowest(): boolean {
    let best: { rootId: number; ms: number } | undefined;
    for (const s of this.engine.tracer.recent()) {
      if (!s.done || s.partial || s.endedAt === undefined) continue;
      const ms = s.endedAt - s.startedAt;
      if (!best || ms > best.ms) best = { rootId: s.rootId, ms };
    }
    if (best) this.engine.tracer.followRoot(best.rootId);
    this.publish();
    return !!best;
  }

  /**
   * Follow the message that dead-lettered most recently, or wait for the next one. By dead-letter time,
   * not creation order: an older message can dead-letter after a newer one (more deliveries, a longer path).
   */
  traceDeadLettered(): "now" | "waiting" {
    let hit: { rootId: number; at: number } | undefined;
    for (const s of this.engine.tracer.recent()) {
      // Ties go to the later record, as a newer message would have won before.
      if (s.deadLetteredAt !== undefined && (!hit || s.deadLetteredAt >= hit.at))
        hit = { rootId: s.rootId, at: s.deadLetteredAt };
    }
    if (hit) this.engine.tracer.followRoot(hit.rootId);
    else this.engine.tracer.request({ next: "deadletter" });
    this.publish();
    return hit ? "now" : "waiting";
  }

  /** One sampled message at a node, whatever the dot scale ("Send one now" while a trace waits there). */
  sendOne(nodeId: string, type?: string): void {
    this.engine.inject(nodeId, 1, type ? { type } : undefined);
    this.dirty = true;
    this.publish();
  }

  endTrace(): void {
    if (!this.engine.tracer.followed() && !this.engine.tracer.pending()) return;
    this.engine.tracer.clear();
    this.publish();
  }

  /**
   * Slow motion owns the engine while it records ahead and replays (src/live/slowmo/session.ts):
   * held, live stays paused and play, step, continue and seek do nothing, whichever control asks.
   * Rebuilds (restart, a structural edit) still happen; slow motion drops itself then.
   */
  hold(on: boolean): void {
    this.held = on;
  }

  get isHeld(): boolean {
    return this.held;
  }

  /**
   * Slow motion's look-ahead: checkpoint the whole run now, let the caller step simulated time and
   * read the tracer, then `restore()` exactly. Pausing notes on the way pass, as in `seek`, and the
   * timeline's trace actions wait, so the tracer keeps the caller's message. Call it held (`hold`);
   * nothing is published until `restore()`.
   */
  lookAhead(): LookAhead {
    const runner = this.runner,
      engine = this.engine;
    const cp = runner ? runner.checkpoint() : engine.checkpoint();
    const time = () => (runner ? runner.state().time : engine.metrics().time);
    runner?.setTraceActions(false);
    return {
      tracer: engine.tracer,
      time,
      step: (simMs) => {
        const before = time();
        if (runner) {
          if (runner.state().done) return false;
          // Several pausing notes can share a moment: pass them all before stepping.
          for (let guard = 0; runner.state().waiting && guard < 1000; guard++) runner.resume();
          runner.step(simMs / this.speed);
        } else engine.step(simMs / this.speed);
        return time() > before;
      },
      // Free play with no traffic and nothing in the system: no message can ever arrive.
      idle: () => {
        if (runner) return runner.state().done;
        const m = engine.metrics();
        return !this.traffic && m.inSystem === 0 && m.pendingInjections === 0;
      },
      lag: (nodeId) => {
        // Read the engine directly: the published (frozen) snapshot must not move.
        const snap = engine.snapshot();
        const n = snap.nodes[nodeId];
        return n ? Math.round(n.backlog * resolveScale(snap.scale)) : undefined;
      },
      restore: () => {
        if (runner) {
          runner.restore(cp as SimulationRunCheckpoint);
          runner.setTraceActions(true);
        } else engine.restore(cp);
        this.applySpeed();
        this.engine.setTraffic(this.traffic);
        this.dirty = true;
      },
    };
  }

  private readTrace(): LiveTrace | null {
    const tracer = this.engine.tracer;
    const rootId = tracer.followed();
    const pending = tracer.pending();
    if (rootId === undefined && !pending) return null;
    return { rootId, pending, current: tracer.current() };
  }

  /** Scrubbing restores older engine state: keep following the same message (ids are deterministic). */
  private keepTrace(intent: TraceIntent): void {
    if (intent.kind === "root") this.engine.tracer.followRoot(intent.rootId);
    else if (intent.kind === "pending") this.engine.tracer.request(intent.request);
    else this.engine.tracer.clear();
  }

  // ---------------------------------------------------------------- playback

  /** Advance by wall-clock ms (speed applies). No-op while paused, waiting on a note, or done. */
  advance(wallMs: number): void {
    if (!this.playing || this.held || this.replayTarget !== null || !(wallMs > 0)) return;
    if (this.runner) {
      this.runner.step(wallMs);
      this.captureCheckpoint();
      this.dirty = true;
      this.snapshot();
      if (this.runState?.done) {
        this.playing = false;
        this.publish();
      }
    } else {
      this.engine.step(wallMs);
      this.dirty = true;
    }
  }

  setPlaying(on: boolean): void {
    if (this.held) return;
    // A finished run plays again from the start.
    if (on && this.runState?.done) {
      this.cancelReplay();
      this.build();
    }
    this.playing = on;
    this.publish();
  }

  togglePlaying(): void {
    this.setPlaying(!this.playing);
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(8, speed));
    this.applySpeed();
    this.publish();
  }

  setTraffic(on: boolean): void {
    this.traffic = on;
    this.engine.setTraffic(on);
    this.publish();
  }

  /** Advance a fixed slice of sim time, playing or not. */
  step(simMs = STEP_MS): void {
    if (this.held || this.replayTarget !== null) return;
    const wall = simMs / this.speed;
    if (this.runner) {
      if (this.runState?.waiting || this.runState?.done) return;
      this.runner.step(wall);
      this.captureCheckpoint();
    } else this.engine.step(wall);
    this.dirty = true;
    this.publish();
  }

  /** Continue after a pausing note. */
  resume(): void {
    if (this.held) return;
    this.runner?.resume();
    this.dirty = true;
    this.publish();
  }

  /** Start over: same diagram, same simulation and seed; live tweaks are dropped. */
  restart(): void {
    this.cancelReplay();
    this.build();
    this.publish();
  }

  /**
   * Jump to `targetMs`, restoring the nearest retained full-run checkpoint when moving back.
   * Older positions fall back to the origin. Pausing notes on the way are skipped.
   */
  seek(targetMs: number): void {
    if (!this.runner || this.held) return;
    if (!Number.isFinite(targetMs)) return;
    const target = Math.max(0, targetMs);
    this.cancelReplay();
    if (target < this.snapshot().time - 1) {
      const rootId = this.engine.tracer.followed(),
        pending = this.engine.tracer.pending();
      const intent: TraceIntent =
        rootId !== undefined
          ? { kind: "root", rootId }
          : pending
            ? { kind: "pending", request: pending }
            : { kind: "idle" };
      const cp = [...this.checkpoints].reverse().find((cp) => cp.time <= target);
      if (cp) {
        this.runner.restore(cp);
        this.checkpoints = this.checkpoints.filter((p) => p.time <= cp.time);
        this.applySpeed();
        this.engine.setTraffic(this.traffic);
      } else this.build();
      this.keepTrace(intent);
    }
    let guard = 0;
    while (guard++ < 10_000) {
      const s = this.runner.state();
      if (s.done || s.time >= target - 5) break;
      if (s.waiting) {
        this.runner.resume();
        continue;
      }
      const before = s.time;
      this.runner.step(Math.min(1000, target - s.time) / this.speed);
      this.captureCheckpoint();
      if (this.runner.state().time <= before && !this.runner.state().waiting) break;
    }
    this.dirty = true;
    this.publish();
  }

  /** Switch between free play (null) and a saved simulation. Rebuilds, keeps play / pause, clears inputs. */
  selectSimulation(sim: Simulation | null): void {
    this.cancelReplay();
    this.base = sim;
    this.inputs = emptyInputs();
    this.sim = sim;
    this.build();
    this.publish();
  }

  // ---------------------------------------------------------------- inputs & capacity

  /**
   * The selected simulation's saved definition changed (Save, undo, Apply fix). The panel's inputs
   * stay on top. Prop and multiplier changes patch the running run; anything else replays it.
   */
  setBase(sim: Simulation): void {
    this.base = sim;
    this.applyInputs();
  }

  /**
   * The Inputs & capacity panel's what-ifs. Multipliers and node props apply to the running engine
   * at once (no restart); entry rates and the dot scale replay the run to the same moment shortly
   * after the last change (or immediately with `replayDelayMs: 0`).
   */
  setInputs(inputs: LiveInputs): void {
    this.inputs = inputs;
    this.applyInputs();
  }

  /** Saved: `saved` becomes the base and the inputs are folded into it (no restart when equal). */
  commitInputs(saved: Simulation | null, diagram?: DiagramFile): void {
    if (!saved && diagram) {
      // Fold saved base props and normalize the multiplier in ONE allocation pass.
      const patches = Object.fromEntries(diagram.nodes.map((n) => [n.id, n.props ?? {}]));
      this.engine.setNodePropsBatch(patches, 1);
    }
    if (diagram) {
      this.diagram = diagram;
      this.rememberProps(diagram);
    }
    this.inputs = emptyInputs();
    if (saved) this.base = saved;
    if (!saved && diagram) this.freeApplied = {};
    this.applyInputs();
  }

  /** Runs a pending replay now (before saving, and in tests). */
  flush(): void {
    if (this.replayTimer === undefined) return;
    this.cancelReplay(true);
    this.replay();
  }

  /** Stop timers (the live view unmounted). */
  dispose(): void {
    this.cancelReplay();
  }

  private applyInputs(): void {
    if (this.base) {
      const next = effectiveSimulation(this.base, this.inputs);
      const prev = this.sim;
      this.sim = next;
      if (
        !prev ||
        !this.runner ||
        this.replayTarget !== null ||
        this.replayTimer !== undefined ||
        !sameScript(prev, next)
      )
        this.scheduleReplay();
      else this.patchRun(prev, next);
    } else if (freePlayScale(this.diagram, this.inputs) !== this.freeScale) {
      this.scheduleReplay();
    } else {
      this.patchFree();
    }
    this.dirty = true;
    this.publish();
  }

  /** Diagram value for a prop no override covers any more. */
  private diagramProp(id: string, key: string): unknown {
    return this.diagram.nodes.find((n) => n.id === id)?.props?.[key];
  }

  private patchProps(
    before: Record<string, Record<string, unknown>>,
    after: Record<string, Record<string, unknown>>,
  ): void {
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = before[id] ?? {},
        b = after[id] ?? {};
      const delta: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        if (valueKey(a[key]) !== valueKey(b[key])) delta[key] = key in b ? b[key] : this.diagramProp(id, key);
      if (Object.keys(delta).length) this.engine.setNodeProps(id, delta as NodeSimProps);
    }
  }

  private patchRun(prev: Simulation, next: Simulation): void {
    this.checkpoints = [];
    this.patchProps(prev.setup?.props ?? {}, next.setup?.props ?? {});
    this.runner?.setMultipliers({
      traffic: resolveMultiplier(next.multipliers?.traffic),
      capacity: resolveMultiplier(next.multipliers?.capacity),
    });
  }

  private patchFree(): void {
    const props = freePlayProps(this.diagram, this.inputs);
    this.patchProps(this.freeApplied, props);
    this.freeApplied = props;
    this.engine.setCapacityMultiplier(this.inputs.capacity ?? 1);
  }

  private scheduleReplay(): void {
    const delay = this.opts.replayDelayMs ?? 250;
    this.cancelReplay(true);
    if (delay <= 0) return this.replay();
    this.replayTimer = setTimeout(() => {
      this.replayTimer = undefined;
      this.replay();
    }, delay);
  }

  private cancelReplay(keepTarget = false): void {
    clearTimeout(this.replayTimer);
    this.replayTimer = undefined;
    this.replayFrame?.();
    this.replayFrame = undefined;
    if (!keepTarget) this.replayTarget = null;
  }

  private yieldReplay(work: () => void): void {
    if (typeof requestAnimationFrame === "function") {
      const id = requestAnimationFrame(work);
      this.replayFrame = () => cancelAnimationFrame(id);
    } else {
      const id = setTimeout(work, 1);
      this.replayFrame = () => clearTimeout(id);
    }
  }

  /** Each slice handles at most 200 ticks / ~6 ms, then yields to the next browser frame. */
  private replay(): void {
    const target = this.replayTarget ?? this.snapshot().time;
    this.build();
    if (!this.runner || target <= 0) {
      this.replayTarget = null;
      this.publish();
      return;
    }
    this.replayTarget = target;
    const runner = this.runner;
    const chunk = () => {
      this.replayFrame = undefined;
      const start = performance.now();
      for (let slices = 0; slices < 20; slices++) {
        const s = runner.state();
        if (s.done || s.time >= target - 5) {
          this.replayTarget = null;
          break;
        }
        if (s.waiting) runner.resume();
        else runner.step(Math.min(100, target - s.time) / this.speed);
        this.captureCheckpoint();
        if (performance.now() - start >= 6) break;
      }
      this.dirty = true;
      this.publish();
      if (this.replayTarget !== null) this.yieldReplay(chunk);
    };
    // The first slice is bounded too; even replayDelayMs: 0 never seeks synchronously.
    chunk();
  }

  // ---------------------------------------------------------------- live tweaks (engine only)

  /** Inject `count` real messages (sampled to dots at the current scale). */
  inject(nodeId: string, count: number, opts?: InjectOptions): void {
    this.injectReal(nodeId, count, opts);
    this.dirty = true;
    this.publish();
  }

  /** Injects at every node that has no incoming edges (the diagram's entry points). */
  injectAtSources(count: number): string[] {
    const edges = flowEdges(this.diagram.edges);
    const targets = new Set(edges.map((e) => e.to));
    const sources = this.diagram.nodes
      .filter((n) => !targets.has(n.id) && edges.some((e) => e.from === n.id))
      .map((n) => n.id);
    for (const id of sources) this.injectReal(id, count);
    this.dirty = true;
    this.publish();
    return sources;
  }

  setNodeStatus(nodeId: string, status: NodeStatus): void {
    this.engine.setNodeStatus(nodeId, status);
    const t = this.tweaks.get(nodeId) ?? { props: {} };
    this.tweaks.set(nodeId, { ...t, status });
    this.dirty = true;
    this.publish();
  }

  setNodeProps(nodeId: string, patch: NodeSimProps): void {
    this.engine.setNodeProps(nodeId, patch);
    const t = this.tweaks.get(nodeId) ?? { props: {} };
    this.tweaks.set(nodeId, { ...t, props: { ...t.props, ...patch } });
    this.dirty = true;
    this.publish();
  }

  /** Forget a node's tweaks (after saving them to the diagram, for instance). */
  clearTweaks(nodeId: string): void {
    this.tweaks.delete(nodeId);
    this.publish();
  }

  /** Current engine props, including setup, timeline actions and live tweaks. */
  effectiveProps(nodeId: string): Record<string, unknown> {
    return this.engine.effectiveProps(nodeId);
  }

  // ---------------------------------------------------------------- diagram edits

  /**
   * The diagram changed in the editor. Moving nodes does nothing; node prop edits are applied to
   * the running engine; topology / label / edge changes rebuild it (play state is kept).
   */
  updateDiagram(next: DiagramFile): DiagramUpdate {
    const key = structuralKey(next);
    if (key !== this.structKey) {
      this.cancelReplay();
      this.diagram = next;
      this.structKey = key;
      this.rememberProps(next);
      this.build();
      this.publish();
      return "reloaded";
    }
    let patched = false;
    for (const node of next.nodes) {
      const k = propsKey(node.props);
      if (this.nodeProps.get(node.id) === k) continue;
      const before = JSON.parse(this.nodeProps.get(node.id) ?? "{}") as Record<string, unknown>;
      const after = node.props ?? {};
      // Keys a simulation's setup (or the panel) overrides keep their override.
      const covered = (this.sim ? this.sim.setup?.props?.[node.id] : this.freeApplied[node.id]) ?? {};
      const delta = Object.fromEntries(
        [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((p) => valueKey(after[p]) !== valueKey(before[p]) && !(p in covered))
          .map((p) => [p, after[p]]),
      );
      this.engine.setNodeProps(node.id, delta as NodeSimProps);
      if (after.status !== before.status) {
        const s = after.status;
        this.engine.setNodeStatus(node.id, s === "paused" || s === "down" ? s : "up");
      }
      this.nodeProps.set(node.id, k);
      patched = true;
    }
    this.diagram = next;
    if (patched) {
      if (!this.sim) this.applyInputs();
      this.checkpoints = [];
      this.captureCheckpoint(true);
      this.dirty = true;
      this.publish();
    }
    return patched ? "patched" : "none";
  }

  // ---------------------------------------------------------------- internals

  /** Runs may own their speed (a `setSpeed` on the runner); otherwise the engine's speed applies. */
  private applySpeed(): void {
    const runner = this.runner as (SimulationRun & { setSpeed?: (speed: number) => void }) | null;
    if (runner?.setSpeed) runner.setSpeed(this.speed);
    else this.engine.setSpeed(this.speed);
  }

  private injectReal(nodeId: string, count: number, opts?: InjectOptions): void {
    if (this.runner) return this.runner.inject(nodeId, count, opts);
    this.injector.inject(nodeId, count, this.scale, opts);
  }

  private rememberProps(d: DiagramFile): void {
    this.nodeProps = new Map(d.nodes.map((n) => [n.id, propsKey(n.props)]));
  }

  private captureCheckpoint(force = false): void {
    if (!this.runner) return;
    const time = this.runner.state().time;
    const last = this.checkpoints.at(-1);
    if (!force && last && time < last.time + 5000) return;
    this.checkpoints.push(this.runner.checkpoint());
    // Keep the origin and at most 23 recent samples (~two minutes); old tokens are GC-able.
    if (this.checkpoints.length > 24) this.checkpoints.splice(1, 1);
  }

  private build(): void {
    const engineOpts = { roleOf: this.opts.roleOf, maxParticles: this.opts.maxParticles, traceHistory: TRACE_HISTORY };
    if (this.sim) {
      // No saved dot scale: pick one from the traffic (the 1/2/5 series, about 60 dots a second at
      // most), so dense runs stay readable as separate dots instead of merging into solid lines.
      const sim = this.sim.scale === undefined ? { ...this.sim, scale: autoScale(this.sim, this.diagram) } : this.sim;
      this.runner = createSimulationRun(this.diagram, sim, {
        ...engineOpts,
        seed: this.opts.seed ?? DEFAULT_SEED,
      });
      this.engine = this.runner.engine;
    } else {
      this.runner = null;
      this.engine = createEngine({ ...engineOpts, seed: this.opts.seed ?? DEFAULT_SEED });
      this.engine.load(this.diagram);
      // Free play's inputs: overrides, rates × traffic, Capacity × and an automatic dot scale.
      this.freeScale = freePlayScale(this.diagram, this.inputs);
      this.engine.setScale(this.freeScale);
      this.freeApplied = freePlayProps(this.diagram, this.inputs);
      for (const [id, props] of Object.entries(this.freeApplied)) this.engine.setNodeProps(id, props as NodeSimProps);
      this.engine.setCapacityMultiplier(this.inputs.capacity ?? 1);
    }
    this.applySpeed();
    this.engine.setTraffic(this.traffic);
    this.tweaks.clear();
    this.injector = createRealCountInjector(
      this.engine,
      (id) => this.diagram.nodes.find((n) => n.id === id),
      this.opts.roleOf ?? stencilRole,
    );
    this.checkpoints = [];
    this.captureCheckpoint(true);
    this.generation++;
    this.dirty = true;
  }
}
