import { revisionAtLeast } from "../model/revisions";
import type { Fault } from "../model/faults";
import { faultTimelineProblem } from "../model/faultRuntime";
import { simulationProjection } from "../sim/simulationContent";
// The live view's model: one engine (free play) or one simulation run (a saved simulation), plus
// the playback state around it. Pure TypeScript with no DOM or React, so it is unit-tested directly.
// The UI drives it from requestAnimationFrame (`advance`) and reads `snapshot()` every frame;
// React components subscribe to `getState()`, which is republished at ~8 Hz while playing.
//
// Units: this is the live UI's conversion boundary. The engine simulates sampled dots (one dot =
// `scale` real messages). `snapshot()` stays sampled for particles and decorations; the published
// `state.snapshot` is converted once to real messages for every number people read, and manual
// injections take real counts (fractions of a dot carry over to the next injection).
//
// Every change to the run goes through `apply` and its control log (./controlLog.ts): each op is stamped with the
// tick it lands on. A scrub back or a rebuild runs the ticks again and applies the logged tweaks on their ticks, so
// they survive it; a seek back cuts the log there (what came after is a branch no longer taken).
//
// Fix verification (src/live/threadFixPlan.ts) replays the run as it actually played, which the log alone does not
// say (Inputs rewrite history only when they rebuild). So every change the controller makes to the running engine
// goes through `mutate` (src/sim/replayControls.ts): it is applied and kept, in order and with its time, in the
// engine's trail. The trail and the origin the engine was built from are the verification context.

import { resourceBudgetExceeded, MAX_LIFECYCLE_REPLICAS, LifecycleBudgetError } from "../model/resourceBudget";
import { simulationProblem, validateDiagram } from "../interop/native";
import { flowEdges } from "../model/relations";
import type { DiagramFile, Simulation } from "../model/types";
import { createRealCountInjector } from "../sim/injection";
import { stencilRole } from "../stencils/roles";
import { createEngine, randomDraws, WorkBudgetError } from "../sim/engine";
import {
  applyDue,
  deepFreeze,
  dispatchReplayControl,
  untilDue,
  type ReplayControl,
  type TimedReplayControl,
  type VerificationContext,
  type VerificationOrigin,
} from "../sim/replayControls";
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
import { t } from "../i18n";
import { autoScale } from "../sim/scale";
import { effectiveSimulation, emptyInputs, freePlayProps, freePlayScale, type LiveInputs } from "./capacityModel";
import { DEFAULT_SEED } from "./storm";
import { snapshotContinuity } from "./snapshotContinuity";
import { own, replayed, tickTime, timeTick, type LiveOp, type LogEntry, type OpOrigin } from "./controlLog";

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
  /** Requested settings are stopped until a successful rebuild replaces a refused run. */
  needsRestart: boolean;
  /** Recoverable run-wide CPU accounting refusal, also applies to manual/scripted bursts. */
  resourceError?: string;
  playing: boolean;
  speed: number;
  traffic: boolean;
  /** The selected simulation as saved (or the unsaved draft), or null for free play. */
  simulation: Simulation | null;
  /** Requested configuration; it runs only when `needsRestart` is false. */
  running: Simulation | null;
  /** The panel's what-if inputs (unsaved until "Save"). */
  inputs: LiveInputs;
  /** Real units: counters, rates, backlog and in-flight are real messages, not sampled dots. */
  snapshot: RealSimSnapshot;
  /** Real messages per dot in the running engine. */
  scale: number;
  run: SimulationRunState | null;
  tweaks: ReadonlyMap<string, NodeTweak>;
  configuration: Record<string, Record<string, unknown>>;
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
  /** A budget stopped this forecast; restore it and leave Live paused. */
  readonly refused: boolean;
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

export type DiagramUpdate = "none" | "patched" | "reloaded" | "refused";
export type SimulationSelection = "rejected" | "selected" | "selected-refused";

/** Shared simulation content, excluding props/scripts that the controller patches separately. */
export function structuralKey(d: DiagramFile): string {
  return JSON.stringify(simulationProjection(d, true));
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

/** Every op kind is handled: a new one fails to compile until it is. */
function unreachable(op: never): void {
  void op;
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
  private continuity = {};
  private real: RealSimSnapshot | null = null;
  /** Free play's fractional injection credit per node and type (runs keep their own). */
  private injector!: ReturnType<typeof createRealCountInjector>;
  /**
   * Full-run checkpoints, each with the log position it was taken at (ops after it are replayed on restore) and the
   * trail's length then.
   */
  private checkpoints: { cp: SimulationRunCheckpoint; seq: number; trail: number }[] = [];
  private log: LogEntry[] = [];
  private seq = 0;
  /** The last logged op the engine's state reflects: `seq` live, behind it while a replay catches up. */
  private applied = 0;
  /** Logged tweaks a newer panel or diagram edit replaced, by seq: the props keys (and "status") replay skips. */
  private superseded = new Map<number, Set<string>>();
  /** Live tweaks that arrived while a replay was catching up: applied, in order, on the tick it reaches. */
  private queued: { op: LiveOp; origin: OpOrigin }[] = [];
  private run = 0;
  /** Who the ops being made now come from (`as`). */
  private origin: OpOrigin = "user";
  private opListeners = new Set<(entry: LogEntry, origin: OpOrigin) => void>();
  private runState: SimulationRunState | null = null;
  private dirty = true;
  private playing = false;
  /** Slow motion holds live still (see `hold`): play, step, continue and seek wait. */
  private held = false;
  private speed = 1;
  private traffic = false;
  /** What the current engine was built from, detached (see `verificationContext`). */
  private runOrigin!: VerificationOrigin;
  /** Every control applied to the current engine since it was built, in order; checkpoints remember its length. */
  private trail: TimedReplayControl[] = [];
  /** Increases with every change to the origin or the trail, and whenever a rebuild is pending. */
  private revision = 0;
  private context: VerificationContext | undefined;
  private generation = 0;
  private tweaks = new Map<string, NodeTweak>();
  private listeners = new Set<() => void>();
  private state!: LiveState;
  private resourceError?: string;
  private needsRestart = false;
  private structKey: string;
  private nodeProps = new Map<string, string>();

  constructor(
    diagram: DiagramFile,
    private opts: ControllerOptions = {},
  ) {
    this.diagram = diagram;
    this.structKey = structuralKey(diagram);
    this.rememberProps(diagram);
    this.newRun();
    if (this.build() === "refused") throw new Error("Initial free-play build refused");
    this.publish();
  }

  // ---------------------------------------------------------------- the control log

  /** The tick the run is on: simulation time in whole ticks. */
  get tick(): number {
    return timeTick(this.engine.metrics().time);
  }

  /** The run the log belongs to (bumps on restart, another simulation and a structural edit). */
  get runId(): number {
    return this.run;
  }

  /** This run's ops so far, in order. */
  controlLog(): readonly LogEntry[] {
    return this.log;
  }

  /** Only losses actually caused by the simulation's explicitly overridden deadlines are expected. */
  expectedTimeoutLosses(): Record<string, number> {
    const edges = new Set(
      Object.entries(this.sim?.setup?.edges ?? {})
        .filter(([, setup]) => !!setup.caller?.deadlineMs)
        .map(([id]) => id),
    );
    return Object.fromEntries(
      Object.entries(this.engine.timeoutLosses(edges)).map(([id, count]) => [id, count * this.scale]),
    );
  }

  /**
   * Changes whenever a same-seed replay of this run would change: a control, an input or diagram edit patched in, a
   * seek, a rebuild (pending or done). Time passing and the simulation's own timeline never change it.
   */
  get verificationRevision(): number {
    return this.revision;
  }

  /**
   * The run as it played, for a same-seed replay (src/sim/headless.ts): the origin its engine was built from and
   * every control since, in order. Immutable, and the same object until the revision changes. Only meaningful while
   * the engine is at its logged state (not `busy`, not `needsRestart`).
   */
  verificationContext(): VerificationContext {
    return (this.context ??= Object.freeze({
      revision: this.revision,
      origin: this.runOrigin,
      controls: Object.freeze([...this.trail]),
    }));
  }

  private invalidateVerification(): void {
    this.revision++;
    this.context = undefined;
  }

  /**
   * Applies one change to the running engine and keeps it in the trail, at the engine's time. A change a budget
   * refuses is validated before it touches the run (src/sim/simulation.ts `transaction`), so it isn't kept.
   */
  private mutate(op: ReplayControl): void {
    const runner = this.runner;
    const time = this.engine.metrics().time;
    this.invalidateVerification();
    dispatchReplayControl(op, {
      engine: this.engine,
      resume: () => runner?.resume(),
      inject: (node, count, opts) => this.injectReal(node, count, opts),
      setMultipliers: runner ? (patch) => runner.setMultipliers(patch) : undefined,
    });
    this.trail.push(deepFreeze({ time, op: structuredClone(op) }));
  }

  /** Each op as it's logged, with who made it (shared Live sends them; nothing else listens yet). */
  onOp(listener: (entry: LogEntry, origin: OpOrigin) => void): () => void {
    this.opListeners.add(listener);
    return () => this.opListeners.delete(listener);
  }

  /** Runs `fn` with the ops it makes attributed to `origin` (a document sync, the room's host). */
  as<T>(origin: OpOrigin, fn: () => T): T {
    const was = this.origin;
    this.origin = origin;
    try {
      return fn();
    } finally {
      this.origin = was;
    }
  }

  /** A replay or a rebuild is on its way or under way: the engine isn't at the logged ops' state yet. */
  get busy(): boolean {
    return this.replayTarget !== null || this.replayTimer !== undefined;
  }

  /**
   * One of the room's host's ops (Watch together), applied here as the host's controller applied it, on the same
   * tick, through the same methods, and logged as remote. A seek goes to the tick the host's seek reached. Ops that
   * start a run (restart, another simulation, a structural edit) do nothing here: the follower rebuilds from the
   * run's start.
   */
  applyRemote(entry: { tick: number; op: LiveOp }): void {
    const op = entry.op;
    this.as("remote", () => {
      switch (op.kind) {
        case "play":
          return this.setPlaying(op.on);
        case "speed":
          return this.setSpeed(op.speed);
        case "step":
          return this.step(op.simMs);
        case "seek":
          return this.seek(tickTime(entry.tick));
        case "resume":
          return this.resume();
        case "inputs":
          return this.setInputs(op.inputs);
        case "base":
          return this.setBase(op.simulation);
        case "commit":
          return this.commitInputs(op.simulation, op.props ? this.withProps(op.props) : undefined);
        case "patch":
          return this.patchRemote(op.patches, op.statuses, op.nodes ?? {});
        case "traffic":
          return this.setTraffic(op.on);
        case "inject":
          return this.inject(op.node, op.count, op.opts);
        case "injectSources":
          this.injectAtSources(op.count);
          return;
        case "sendOne":
          return this.sendOne(op.node, op.type);
        case "fault":
          return this.setFault(op.fault);
        case "status":
          return this.setNodeStatus(op.node, op.status);
        case "props":
          return this.setNodeProps(op.node, op.patch);
        case "restart":
        case "select":
        case "reload":
          return;
        default:
          return unreachable(op);
      }
    });
  }

  /** The diagram with these node props (by id) in place of its own. */
  private withProps(props: Record<string, Record<string, unknown>>): DiagramFile {
    return { ...this.diagram, nodes: this.diagram.nodes.map((n) => (props[n.id] ? { ...n, props: props[n.id] } : n)) };
  }

  /**
   * Shared Live's catch-up: the run forward to `tick` (never back), neither logged nor published (the caller
   * publishes once per slice). Playing on, it stops at a pausing note, as the host's run did (the host's resume op
   * passes it); on the way to a seek's target (`seeking`) it passes them, as the host's seek did.
   */
  advanceTo(tick: number, seeking = false): void {
    if (this.needsRestart || this.held || this.replayTarget !== null) return;
    const target = tickTime(tick);
    if (this.runner) {
      for (let guard = 0; guard < 10_000; guard++) {
        const s = this.runner.state();
        if (s.done || s.time >= target - 5) break;
        if (s.waiting) {
          if (!seeking) break;
          if (!this.updateRunner(() => this.mutate({ kind: "resume" }))) return;
          continue;
        }
        const before = s.time;
        if (!this.updateRunner(() => this.runner?.step(Math.min(1000, target - s.time) / this.speed))) return;
        this.captureCheckpoint();
        if (this.runner.state().time <= before) break;
      }
    } else {
      const ms = target - this.engine.metrics().time;
      if (ms > 0 && !this.updateRunner(() => this.engine.step(ms / this.speed))) return;
    }
    this.dirty = true;
  }

  /** Simulated ms a seek to `targetMs` would run at once: forward from now, or back from the nearest checkpoint. */
  seekCost(targetMs: number): number {
    const now = this.engine.metrics().time;
    if (targetMs >= now - 1) return Math.max(0, targetMs - now);
    const found = [...this.checkpoints].reverse().find((p) => p.cp.time <= targetMs);
    return targetMs - (found ? found.cp.time : 0);
  }

  /**
   * What a run digest is made of, detached (src/sim/digest.ts `snapshotDigest`): two runs that played the same
   * ticks with the same ops agree on it, in any browser. Shared Live loads the digest with its own code.
   */
  digestInputs(): { snapshot: SimSnapshot; draws: number } {
    return { snapshot: this.engine.snapshot(), draws: randomDraws(this.engine) };
  }

  /**
   * Applies an engine tweak now and logs it on this tick. While a replay is catching up it waits, in order, for the
   * tick the replay is heading for (the replay keeps its slices: nothing runs it to the end at once).
   */
  private apply(op: LiveOp): void {
    if (this.needsRestart) return;
    // Behind a replay, or behind earlier ops still waiting (a refused Continue): in order, after them.
    if (this.replayTarget !== null || this.queued.length) {
      this.queued.push({ op: own(op), origin: this.origin });
      this.publish();
      return;
    }
    if (!this.updateRunner(() => this.execute(op))) return;
    this.record(op);
    this.dirty = true;
    this.publish();
  }

  /**
   * The replay reached its tick: the tweaks that waited for it apply and are logged there, in order. A Continue the
   * resource budget refuses stops here: it and the rest keep waiting for a retry (Continue again) or a cancel.
   */
  private applyQueued(): void {
    while (!this.needsRestart && this.queued.length) {
      const { origin } = this.queued[0];
      const op = structuredClone(this.queued[0].op) as LiveOp;
      if (op.kind === "resume") {
        if (!this.continueRun()) return;
      } else if (!this.updateRunner(() => this.execute(op))) return;
      this.queued.shift();
      this.record(op, origin);
    }
  }

  /** Continue after a pausing note, guarded: a lifecycle budget refusal becomes the recoverable error state. */
  private continueRun(): boolean {
    return this.updateRunner(() => this.execute({ kind: "resume" }));
  }

  /** Logs an op on this tick. The log keeps its own frozen copy, and only the latest Inputs snapshot. */
  private record(op: LiveOp, origin = this.origin): void {
    // During a replay, an op (play, pause, Inputs…) belongs on the tick the replay is heading for.
    const tick = this.replayTarget !== null ? timeTick(this.replayTarget) : this.tick;
    const entry: LogEntry = Object.freeze({ run: this.run, seq: ++this.seq, tick, op: own(op) });
    if (op.kind === "inputs") this.log = this.log.filter((e) => e.op.kind !== "inputs");
    this.log.push(entry);
    // Live, every op is reflected at once; a replay advances `applied` as it reaches each one.
    if (this.replayTarget === null) this.applied = this.seq;
    for (const listener of this.opListeners) listener(entry, origin);
  }

  /** A new run: its log starts empty. */
  private newRun(): void {
    this.invalidateVerification();
    this.run++;
    this.seq = 0;
    this.applied = 0;
    this.log = [];
    this.superseded = new Map();
    this.queued = [];
  }

  /**
   * A panel or diagram edit replaced these props (and statuses) from now on: older logged tweaks of the same
   * node and key no longer apply when the run is replayed, so the newer choice keeps precedence.
   */
  private supersede(changed: ReadonlyMap<string, ReadonlySet<string>>): void {
    if (!changed.size) return;
    // Tweaks still waiting on a replay: the same keys go, the rest (and the order) stay.
    this.queued = this.queued.flatMap((q): { op: LiveOp; origin: OpOrigin }[] => {
      const op = q.op;
      const keys = (op.kind === "props" || op.kind === "status") && changed.get(op.node);
      if (!keys) return [q];
      if (op.kind === "status") return keys.has("status") ? [] : [q];
      if (op.kind !== "props") return [q];
      const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => !keys.has(k)));
      return Object.keys(patch).length ? [{ ...q, op: { ...op, patch: patch as NodeSimProps } }] : [];
    });
    for (const e of this.log) {
      if (e.op.kind !== "props" && e.op.kind !== "status") continue;
      const keys = changed.get(e.op.node);
      if (!keys) continue;
      const hit =
        e.op.kind === "props"
          ? Object.keys(e.op.patch).filter((k) => keys.has(k))
          : keys.has("status")
            ? ["status"]
            : [];
      if (!hit.length) continue;
      const set = this.superseded.get(e.seq) ?? new Set<string>();
      for (const k of hit) set.add(k);
      this.superseded.set(e.seq, set);
    }
  }

  /** The node props keys whose values differ between two override maps (by node). */
  private static changedKeys(
    before: Record<string, Record<string, unknown>> | undefined,
    after: Record<string, Record<string, unknown>> | undefined,
  ): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const id of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
      const a = before?.[id] ?? {},
        b = after?.[id] ?? {};
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
        (k) => valueKey(a[k]) !== valueKey(b[k]),
      );
      if (keys.length) out.set(id, new Set(keys));
    }
    return out;
  }

  /** A logged op as a replay applies it: a copy, without what a newer edit superseded (null: nothing left). */
  private replayOp(entry: LogEntry): LiveOp | null {
    const gone = this.superseded.get(entry.seq);
    const op = structuredClone(entry.op) as LiveOp;
    if (!gone) return op;
    if (op.kind === "status") return gone.has("status") ? null : op;
    if (op.kind !== "props") return op;
    const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => !gone.has(k)));
    return Object.keys(patch).length ? { ...op, patch: patch as NodeSimProps } : null;
  }

  /** What an engine op does, live or replayed on its tick. */
  private execute(op: LiveOp): void {
    switch (op.kind) {
      case "resume":
        // Kept even with no note waiting (it changes nothing there, live or replayed): its place in the order counts.
        return this.mutate(op);
      case "traffic":
        this.traffic = op.on && !this.engine.trafficLimit();
        return this.mutate(op);
      case "inject":
      case "sendOne":
      case "fault":
        return this.mutate(op);
      case "injectSources":
        for (const id of this.sourceIds()) this.mutate({ kind: "inject", node: id, count: op.count });
        return;
      case "status": {
        this.mutate(op);
        const t = this.tweaks.get(op.node) ?? { props: {} };
        this.tweaks = new Map(this.tweaks);
        this.tweaks.set(op.node, { ...t, status: op.status });
        return;
      }
      case "props": {
        this.mutate(op);
        const t = this.tweaks.get(op.node) ?? { props: {} };
        this.tweaks = new Map(this.tweaks);
        this.tweaks.set(op.node, { ...t, props: { ...t.props, ...op.patch } });
        return;
      }
      default:
        return;
    }
  }

  /** The logged tweaks after `seq` up to `tick`, to replay in order as the run reaches each one's tick. */
  private pendingAfter(seq: number, tick = Infinity): LogEntry[] {
    return this.log.filter((e) => e.seq > seq && e.tick <= tick && replayed(e));
  }

  /** The logged tweaks after `seq` up to `tick`, timed for the shared replay boundaries (src/sim/replayControls.ts). */
  private timedPending(seq: number, tick = Infinity): { time: number; entry: LogEntry }[] {
    return this.pendingAfter(seq, tick).map((entry) => ({ time: tickTime(entry.tick), entry }));
  }

  /**
   * Applies the pending ops whose tick the run has reached, in order; returns the next cursor. `applied` follows.
   * Callers pass a pausing note only after this, as a headless replay does.
   */
  private reapply(pending: readonly { time: number; entry: LogEntry }[], cursor: number): number {
    return applyDue(pending, cursor, this.engine.metrics().time, ({ entry }) => {
      const op = this.replayOp(entry);
      if (op) this.execute(op);
      this.applied = entry.seq;
    });
  }

  /** Sim ms until the next pending op's tick (Infinity when none): a step never runs past it. */
  private untilNext(pending: readonly { time: number }[], cursor: number): number {
    return untilDue(pending, cursor, this.engine.metrics().time);
  }

  // ---------------------------------------------------------------- reading

  /** Latest engine snapshot; recomputed at most once per advance / action. */
  snapshot(): SimSnapshot {
    if (this.dirty) {
      this.snap = this.engine.snapshot();
      snapshotContinuity.set(this.snap, this.continuity);
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
    const configuration = this.engine.configuration();
    // Inputs, diagram edits, timeline actions and seeking can supersede a live tweak.
    // Keep only keys still present in the engine, preserving unrelated tweaks and old snapshots.
    for (const [id, tweak] of this.tweaks) {
      const props = Object.fromEntries(
        Object.entries(tweak.props).filter(([key, value]) => valueKey(value) === valueKey(configuration[id]?.[key])),
      );
      const status = tweak.status === snapshot.nodes[id]?.status ? tweak.status : undefined;
      if (Object.keys(props).length === Object.keys(tweak.props).length && status === tweak.status) continue;
      this.tweaks = new Map(this.tweaks);
      if (Object.keys(props).length || status) this.tweaks.set(id, { props, ...(status ? { status } : {}) });
      else this.tweaks.delete(id);
    }
    this.state = {
      needsRestart: this.needsRestart,
      resourceError:
        this.resourceError ?? (this.engine.trafficLimit() === "resources" ? t("autoscaling.cpuBudget") : undefined),
      scale: resolveScale(snapshot.scale),
      playing: this.playing,
      speed: this.speed,
      // A traffic change waiting on a replay shows as chosen (a second press reverses it).
      traffic: (this.queuedTraffic() ?? this.traffic) && !this.engine.trafficLimit(),
      simulation: this.base,
      running: this.sim,
      inputs: this.inputs,
      snapshot,
      run: this.runState,
      tweaks: this.tweaks,
      configuration,
      generation: this.generation,
      trace: this.readTrace(),
    };
    for (const l of this.listeners) l();
  }

  private queuedTraffic(): boolean | undefined {
    for (let i = this.queued.length - 1; i >= 0; i--) {
      const op = this.queued[i].op;
      if (op.kind === "traffic") return op.on;
    }
    return undefined;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * The run's settings as they are now, published or not (an op's listeners hear it before the state is
   * republished): the selected simulation, traffic, the what-ifs, speed and play.
   */
  get settings(): {
    simulation: Simulation | null;
    traffic: boolean;
    inputs: LiveInputs;
    speed: number;
    playing: boolean;
  } {
    return {
      simulation: this.base,
      traffic: this.traffic,
      inputs: this.inputs,
      speed: this.speed,
      playing: this.playing,
    };
  }

  /** The saved simulation's run as it is now (waiting at a note, finished), published or not; null in free play. */
  get runNow(): SimulationRunState | null {
    this.snapshot();
    return this.runState;
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
    this.apply({ kind: "sendOne", node: nodeId, ...(type ? { type } : {}) });
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
    let budgetError: unknown;
    runner?.setTraceActions(false);
    return {
      tracer: engine.tracer,
      get refused() {
        return budgetError !== undefined;
      },
      time,
      step: (simMs) => {
        const before = time();
        if (runner) {
          if (runner.state().done) return false;
          try {
            // Several pausing notes can share a moment: pass them all before stepping.
            for (let guard = 0; runner.state().waiting && guard < 1000; guard++) runner.resume();
            runner.step(simMs / this.speed);
          } catch (error) {
            if (!(error instanceof LifecycleBudgetError) && !(error instanceof WorkBudgetError)) throw error;
            budgetError = error;
            // Stop the forecast; its caller restores the sandbox before publishing anything.
            return false;
          }
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
        if (budgetError !== undefined && this.recoverBudget(budgetError)) {
          this.publish();
        }
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
    if (this.needsRestart || !this.playing || this.held || this.replayTarget !== null || !(wallMs > 0)) return;
    if (this.runner) {
      if (!this.updateRunner(() => this.runner?.step(wallMs))) return;
      this.captureCheckpoint();
      this.dirty = true;
      this.snapshot();
      if (this.runState?.done) {
        this.playing = false;
        this.publish();
      }
    } else {
      if (!this.updateRunner(() => this.engine.step(wallMs))) return;
      this.dirty = true;
    }
  }
  /** A refused timeline edit leaves the previous fleet intact and the session renderable. */
  private updateRunner(update: () => void): boolean {
    try {
      update();
      return true;
    } catch (error) {
      if (!this.recoverBudget(error)) throw error;
      this.publish();
      return false;
    }
  }

  private recoverBudget(error: unknown): boolean {
    if (!(error instanceof LifecycleBudgetError) && !(error instanceof WorkBudgetError)) return false;
    this.invalidateVerification();
    this.resourceError = error instanceof WorkBudgetError ? t("liveSession.workBudget") : error.message;
    // A replay slice exits on refusal: abandon its target and queued ops until a rebuild.
    // Queued Continue runs after the target clears, so lifecycle refusals there stay retryable.
    if (error instanceof WorkBudgetError || this.replayTarget !== null) {
      this.needsRestart = true;
      this.cancelReplay();
    }
    this.playing = false;
    this.dirty = true;
    return true;
  }

  setPlaying(on: boolean): void {
    if (this.held || this.needsRestart) return;
    // A finished run plays again from the start.
    if (on && this.runState?.done) {
      this.cancelReplay();
      this.newRun();
      if (this.build() === "refused") {
        this.publish();
        return;
      }
    }
    this.playing = on;
    this.record({ kind: "play", on });
    this.publish();
  }

  togglePlaying(): void {
    this.setPlaying(!this.playing);
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(8, speed));
    if (!this.needsRestart) this.applySpeed();
    this.record({ kind: "speed", speed: this.speed });
    this.publish();
  }

  trafficHint(): string | undefined {
    const limit = this.engine.trafficLimit();
    return limit === "rate"
      ? t("live.sourceRateLimit")
      : limit === "volume"
        ? t("live.sourceVolumeLimit")
        : limit === "resources"
          ? t("autoscaling.cpuBudget")
          : undefined;
  }

  setTraffic(on: boolean): void {
    this.apply({ kind: "traffic", on });
  }

  /** Advance a fixed slice of sim time, playing or not. */
  step(simMs = STEP_MS): void {
    if (this.needsRestart || this.held || this.replayTarget !== null) return;
    const wall = simMs / this.speed;
    this.record({ kind: "step", simMs });
    if (this.runner) {
      if (this.runState?.waiting || this.runState?.done) return;
      if (!this.updateRunner(() => this.runner?.step(wall))) return;
      this.captureCheckpoint();
    } else if (!this.updateRunner(() => this.engine.step(wall))) return;
    this.dirty = true;
    this.publish();
  }

  /** Continue after a pausing note. */
  resume(): void {
    if (this.held || this.needsRestart) return;
    if (this.replayTarget !== null) return this.apply({ kind: "resume" });
    // A refused Continue left ops waiting: this is its retry, then theirs, in order.
    if (this.queued.length) {
      this.applyQueued();
      this.dirty = true;
      return this.publish();
    }
    if (!this.continueRun()) return;
    this.record({ kind: "resume" });
    this.dirty = true;
    this.publish();
  }

  /** Start over: same diagram, same simulation and seed; live tweaks are dropped (a new run, a new log). */
  restart(): boolean {
    this.cancelReplay();
    this.newRun();
    const result = this.build();
    this.record({ kind: "restart" });
    this.publish();
    return result === "ok";
  }

  /**
   * Jump to `targetMs`, restoring the nearest retained full-run checkpoint when moving back.
   * Older positions fall back to the origin. Pausing notes on the way are skipped. The logged tweaks on the way
   * apply again on their ticks; moving back cuts the log at the target.
   */
  seek(targetMs: number): void {
    if (this.needsRestart || !this.runner || this.held) return;
    if (!Number.isFinite(targetMs)) return;
    const target = Math.max(0, targetMs);
    this.continuity = {};
    this.cancelReplay();
    let after = this.applied;
    if (target < this.snapshot().time - 1) {
      const rootId = this.engine.tracer.followed(),
        pending = this.engine.tracer.pending();
      const intent: TraceIntent =
        rootId !== undefined
          ? { kind: "root", rootId }
          : pending
            ? { kind: "pending", request: pending }
            : { kind: "idle" };
      const found = [...this.checkpoints].reverse().find((p) => p.cp.time <= target);
      if (found) {
        this.runner.restore(found.cp);
        this.checkpoints = this.checkpoints.filter((p) => p.cp.time <= found.cp.time);
        this.trail = this.trail.slice(0, found.trail);
        this.applySpeed();
        // Today's traffic switch from the checkpoint on: part of the run from here, so part of its trail.
        this.mutate({ kind: "traffic", on: this.traffic });
        after = this.applied = found.seq;
      } else {
        if (this.build() === "refused") {
          this.publish();
          return;
        }
        after = 0;
      }
      this.keepTrace(intent);
    }
    const pending = this.timedPending(after);
    let cursor = 0;
    let guard = 0;
    while (guard++ < 10_000) {
      if (!this.updateRunner(() => (cursor = this.reapply(pending, cursor)))) return;
      const s = this.runner.state();
      if (s.done || s.time >= target - 5) break;
      if (s.waiting) {
        if (!this.updateRunner(() => this.mutate({ kind: "resume" }))) return;
        continue;
      }
      const before = s.time;
      const ms = Math.min(1000, target - s.time, this.untilNext(pending, cursor));
      if (!this.updateRunner(() => this.runner?.step(ms / this.speed))) return;
      this.captureCheckpoint();
      if (this.runner.state().time <= before && !this.runner.state().waiting) break;
    }
    // What came after the target is a branch no longer taken.
    const reached = this.tick;
    if (this.log.some((e) => e.tick > reached)) this.log = this.log.filter((e) => e.tick <= reached);
    this.invalidateVerification();
    this.record({ kind: "seek", targetMs: target });
    this.dirty = true;
    this.publish();
  }

  /** Switch between free play (null) and a saved simulation. Rebuilds, keeps play / pause, clears inputs. */
  selectSimulation(sim: Simulation | null): SimulationSelection {
    const problem = sim && (simulationProblem(sim) ?? faultTimelineProblem(this.diagram, sim));
    if (problem) {
      this.resourceError = problem;
      this.publish();
      return "rejected";
    }
    if (sim && revisionAtLeast(this.diagram.planning?.revision, "p3-a1")) {
      const candidate = {
        ...this.diagram,
        simulations: [...(this.diagram.simulations ?? []).filter((s) => s.id !== sim.id), sim],
      };
      const validated = validateDiagram(candidate);
      const error = simulationProblem(sim) ?? (!validated.ok ? validated.error : undefined);
      if (error) {
        this.resourceError = error;
        this.publish();
        return "rejected";
      }
    }
    this.cancelReplay();
    this.base = sim;
    this.inputs = emptyInputs();
    this.sim = sim;
    this.newRun();
    const result = this.build();
    this.record({ kind: "select", simulation: sim });
    this.publish();
    return result === "ok" ? "selected" : "selected-refused";
  }

  // ---------------------------------------------------------------- inputs & capacity

  /**
   * The selected simulation's saved definition changed (Save, undo, Apply fix). The panel's inputs
   * stay on top. Prop and multiplier changes patch the running run; anything else replays it.
   */
  setBase(sim: Simulation): void {
    this.supersede(
      LiveController.changedKeys(this.sim?.setup?.props, effectiveSimulation(sim, this.inputs).setup?.props),
    );
    this.base = sim;
    this.record({ kind: "base", simulation: sim });
    this.applyInputs();
  }

  /**
   * The Inputs & capacity panel's what-ifs. Multipliers and node props apply to the running engine
   * at once (no restart); entry rates and the dot scale replay the run to the same moment shortly
   * after the last change (or immediately with `replayDelayMs: 0`).
   */
  setInputs(inputs: LiveInputs): void {
    const simulation = this.base ? effectiveSimulation(this.base, inputs) : undefined;
    const props = simulation?.setup?.props ?? freePlayProps(this.diagram, inputs);
    const previous = this.sim?.setup?.props ?? this.freeApplied;
    if (
      revisionAtLeast(this.diagram.planning?.revision, "p3-a1") &&
      resourceBudgetExceeded(
        {
          ...this.diagram,
          nodes: this.diagram.nodes.map((n) => ({
            ...n,
            props: {
              ...this.engine.effectiveProps(n.id),
              ...Object.fromEntries(
                Object.keys(previous[n.id] ?? {})
                  .filter((key) => !(key in (props[n.id] ?? {})))
                  .map((key) => [key, this.diagramProp(n.id, key)]),
              ),
              ...props[n.id],
            },
          })),
          simulations: simulation ? [simulation] : undefined,
        },
        simulation?.multipliers?.capacity ?? inputs.capacity,
      )
    )
      throw new Error(t("autoscaling.budget", { limit: MAX_LIFECYCLE_REPLICAS }));
    this.supersede(LiveController.changedKeys(previous, props));
    this.inputs = inputs;
    this.record({ kind: "inputs", inputs });
    this.applyInputs();
  }

  /** Saved: `saved` becomes the base and the inputs are folded into it (no restart when equal). */
  commitInputs(saved: Simulation | null, diagram?: DiagramFile): void {
    if (!saved && diagram && !this.needsRestart) {
      // Fold saved base props and normalize the multiplier in ONE allocation pass.
      const patches = Object.fromEntries(
        diagram.nodes.map((n) => [
          n.id,
          n.props?.autoscaling && (n.props.autoscaling as { mode?: string }).mode === "on"
            ? Object.fromEntries(
                Object.entries(n.props).filter(([key]) => key !== "replicas" && key !== "resumeAutoscaling"),
              )
            : (n.props ?? {}),
        ]),
      );
      this.mutate({ kind: "configuration", patches, capacity: 1 });
    }
    // What a follower needs to do the same: the saved simulation, and the props of the nodes the save changed
    // (each node's whole props, so a removed key goes too). Nothing when it changed none.
    const changed = diagram
      ? diagram.nodes.filter((n) => this.nodeProps.get(n.id) !== propsKey(n.props)).map((n) => [n.id, n.props ?? {}])
      : [];
    if (diagram) {
      this.diagram = diagram;
      this.rememberProps(diagram);
    }
    this.inputs = emptyInputs();
    if (saved) this.base = saved;
    if (!saved && diagram) this.freeApplied = {};
    this.record({
      kind: "commit",
      simulation: saved,
      ...(changed.length ? { props: Object.fromEntries(changed) } : {}),
    });
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
        this.needsRestart ||
        !this.runner ||
        this.replayTarget !== null ||
        this.replayTimer !== undefined ||
        !sameScript(prev, next)
      )
        this.scheduleReplay();
      else this.patchRun(prev, next);
    } else if (this.needsRestart || freePlayScale(this.diagram, this.inputs) !== this.freeScale) {
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

  /** The props patch from one override map to another (a key no override covers any more: the diagram's value). */
  private patchProps(
    before: Record<string, Record<string, unknown>>,
    after: Record<string, Record<string, unknown>>,
  ): Record<string, NodeSimProps> {
    const patches: Record<string, NodeSimProps> = {};
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = before[id] ?? {},
        b = after[id] ?? {};
      const delta: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        if (valueKey(a[key]) !== valueKey(b[key])) delta[key] = key in b ? b[key] : this.diagramProp(id, key);
      if (Object.keys(delta).length) patches[id] = delta as NodeSimProps;
    }
    return patches;
  }

  private patchRun(prev: Simulation, next: Simulation): void {
    this.checkpoints = [];
    this.mutate({
      kind: "configuration",
      patches: this.patchProps(prev.setup?.props ?? {}, next.setup?.props ?? {}),
      multipliers: {
        traffic: resolveMultiplier(next.multipliers?.traffic),
        capacity: resolveMultiplier(next.multipliers?.capacity),
      },
    });
  }

  private patchFree(): void {
    const props = freePlayProps(this.diagram, this.inputs);
    this.mutate({
      kind: "configuration",
      patches: this.patchProps(this.freeApplied, props),
      capacity: this.inputs.capacity ?? 1,
    });
    this.freeApplied = props;
  }

  private scheduleReplay(): void {
    const delay = this.opts.replayDelayMs ?? 250;
    // The run is about to be rebuilt with history rewritten: what was verified no longer describes it.
    this.invalidateVerification();
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
    if (keepTarget) return;
    // The replay is abandoned (a restart, another simulation, a seek, the view gone): so are the tweaks waiting on it.
    this.replayTarget = null;
    this.queued = [];
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

  /**
   * Each slice handles at most 200 ticks / ~6 ms, then yields to the next browser frame. The run is rebuilt with
   * the new inputs from the start (history rewritten), and the logged tweaks apply again on their ticks.
   */
  private replay(): void {
    const target = this.replayTarget ?? this.snapshot().time;
    if (this.build() === "refused") {
      this.publish();
      return;
    }
    if (!this.runner || target <= 0) {
      // Free play starts over (nothing to replay to); so does its log. A run at its start keeps tick 0's tweaks.
      if (!this.runner) this.newRun();
      else if (!this.updateRunner(() => this.reapply(this.timedPending(0, 0), 0))) return;
      this.applied = this.seq;
      this.replayTarget = null;
      this.applyQueued();
      this.publish();
      return;
    }
    this.replayTarget = target;
    const runner = this.runner;
    // The rebuilt origin reflects no op yet: checkpoints taken on the way record how far the replay got.
    const pending = this.timedPending(0, timeTick(target));
    let cursor = 0;
    const chunk = () => {
      this.replayFrame = undefined;
      const start = performance.now();
      for (let slices = 0; slices < 20; slices++) {
        if (!this.updateRunner(() => (cursor = this.reapply(pending, cursor)))) return;
        const s = runner.state();
        if (s.done || s.time >= target - 5) {
          this.replayTarget = null;
          this.applied = this.seq;
          this.applyQueued();
          break;
        }
        if (
          !this.updateRunner(() => {
            if (s.waiting) this.mutate({ kind: "resume" });
            else runner.step(Math.min(100, target - s.time, this.untilNext(pending, cursor)) / this.speed);
          })
        )
          return;
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
    this.apply({ kind: "inject", node: nodeId, count, ...(opts ? { opts } : {}) });
  }

  /** Injects at every node that has no incoming edges (the diagram's entry points). */
  injectAtSources(count: number): string[] {
    if (this.needsRestart) return [];
    this.apply({ kind: "injectSources", count });
    return this.sourceIds();
  }

  /** The diagram's entry points: nodes with outgoing flow and no incoming edges. */
  private sourceIds(): string[] {
    const edges = flowEdges(this.diagram.edges);
    const targets = new Set(edges.map((e) => e.to));
    return this.diagram.nodes.filter((n) => !targets.has(n.id) && edges.some((e) => e.from === n.id)).map((n) => n.id);
  }

  setFault(fault: Fault): void {
    this.apply({ kind: "fault", fault });
  }

  setNodeStatus(nodeId: string, status: NodeStatus): void {
    this.apply({ kind: "status", node: nodeId, status });
  }

  setNodeProps(nodeId: string, patch: NodeSimProps): void {
    this.apply({ kind: "props", node: nodeId, patch });
  }

  /** Forget a node's tweaks (after saving them to the diagram, for instance). */
  clearTweaks(nodeId: string): void {
    this.tweaks = new Map(this.tweaks);
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
  replicaPage(nodeId: string, page = 0) {
    return this.engine.replicaPage(nodeId, page);
  }

  /** Observational pool count in real calls; snapshots and simulation results stay unchanged. */
  queuedCalls(edgeId: string): number {
    return this.engine.queuedCalls(edgeId) * this.scale;
  }

  updateDiagram(next: DiagramFile): DiagramUpdate {
    const key = structuralKey(next);
    const previousNodes = new Map(this.diagram.nodes.map((n) => [n.id, n]));
    const resourceChanged = next.nodes.some((n) => {
      const before = previousNodes.get(n.id);
      return (
        valueKey(before?.props?.resources) !== valueKey(n.props?.resources) ||
        valueKey(before?.props?.autoscaling) !== valueKey(n.props?.autoscaling)
      );
    });
    if (this.needsRestart || key !== this.structKey || resourceChanged) {
      this.cancelReplay();
      this.diagram = next;
      this.structKey = key;
      this.rememberProps(next);
      this.newRun();
      const result = this.build();
      this.record({ kind: "reload" });
      this.publish();
      return result === "ok" ? "reloaded" : "refused";
    }
    let patched = false;
    const patches: Record<string, NodeSimProps> = {};
    const statuses: Record<string, NodeStatus> = {};
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
      patches[node.id] = delta as NodeSimProps;
      if (after.status !== before.status) {
        const s = after.status;
        statuses[node.id] = s === "paused" || s === "down" ? s : "up";
      }
      patched = true;
    }
    if (!patched) {
      this.engine.setNodePropsBatch(patches);
      this.diagram = next;
      return "none";
    }
    const nodes = Object.fromEntries(
      next.nodes.filter((n) => n.id in patches || n.id in statuses).map((n) => [n.id, n.props ?? {}]),
    );
    this.applyDiagramPatch(patches, statuses, nodes, next);
    return "patched";
  }

  /**
   * A diagram edit the run takes, this editor's (updateDiagram derives it) or the room's host's (patchRemote, as
   * sent): statuses and props into the engine, the diagram and its remembered props, the tweaks it supersedes, the
   * log, free play's inputs and the checkpoints. One transition for both, so host and follower can't drift apart.
   */
  private applyDiagramPatch(
    patches: Record<string, NodeSimProps>,
    statuses: Record<string, NodeStatus>,
    nodes: Record<string, Record<string, unknown>>,
    next: DiagramFile,
  ): void {
    this.mutate({ kind: "configuration", statuses, patches });
    for (const [id, props] of Object.entries(nodes)) this.nodeProps.set(id, propsKey(props));
    this.diagram = next;
    const changed = new Map<string, Set<string>>();
    for (const [id, delta] of Object.entries(patches))
      if (Object.keys(delta).length) changed.set(id, new Set(Object.keys(delta)));
    for (const id of Object.keys(statuses)) changed.set(id, (changed.get(id) ?? new Set()).add("status"));
    this.supersede(changed);
    this.record({ kind: "patch", patches, statuses, nodes });
    if (!this.sim) this.applyInputs();
    this.checkpoints = [];
    this.captureCheckpoint(true);
    this.dirty = true;
    this.publish();
  }

  /**
   * A diagram edit the room's host's run took (its `patch` op): the same props and statuses, on this tick, whatever
   * this editor's copy of the diagram says by now (a later edit comes as its own op).
   */
  private patchRemote(
    patches: Record<string, NodeSimProps>,
    statuses: Record<string, NodeStatus>,
    nodes: Record<string, Record<string, unknown>>,
  ): void {
    if (this.needsRestart) return;
    // The diagram as the host's run had it after the edit: free play's inputs and the next edit read it.
    const known = Object.fromEntries(Object.entries(nodes).filter(([id]) => this.nodeProps.has(id)));
    this.applyDiagramPatch(patches, statuses, known, this.withProps(known));
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
    if (!force && last && time < last.cp.time + 5000) return;
    this.checkpoints.push({ cp: this.runner.checkpoint(), seq: this.applied, trail: this.trail.length });
    // Keep the origin and at most 23 recent samples (~two minutes); old tokens are GC-able.
    if (this.checkpoints.length > 24) this.checkpoints.splice(1, 1);
  }

  private build(): "ok" | "refused" {
    this.continuity = {};
    this.resourceError = this.sim ? faultTimelineProblem(this.diagram, this.sim) : undefined;
    if (this.resourceError) {
      this.sim = null;
      this.base = null;
    }
    const engineOpts = { roleOf: this.opts.roleOf, maxParticles: this.opts.maxParticles, traceHistory: TRACE_HISTORY };
    let start: Simulation;
    if (this.sim) {
      // No saved dot scale: pick one from the traffic (the 1/2/5 series, about 60 dots a second at
      // most), so dense runs stay readable as separate dots instead of merging into solid lines.
      const sim = this.sim.scale === undefined ? { ...this.sim, scale: autoScale(this.sim, this.diagram) } : this.sim;
      start = { ...sim, seed: sim.seed ?? this.opts.seed ?? DEFAULT_SEED };
      try {
        this.runner = createSimulationRun(this.diagram, sim, {
          ...engineOpts,
          seed: this.opts.seed ?? DEFAULT_SEED,
        });
      } catch (error) {
        if (!this.recoverBudget(error)) throw error;
        this.needsRestart = true;
        this.cancelReplay();
        return "refused";
      }
      this.engine = this.runner.engine;
    } else {
      this.runner = null;
      this.engine = createEngine({ ...engineOpts, seed: this.opts.seed ?? DEFAULT_SEED });
      this.engine.load(this.diagram);
      // Free play's inputs: overrides, rates × traffic, Capacity × and an automatic dot scale.
      this.freeScale = freePlayScale(this.diagram, this.inputs);
      this.engine.setScale(this.freeScale);
      this.freeApplied = freePlayProps(this.diagram, this.inputs);
      this.engine.setNodePropsBatch(this.freeApplied as Record<string, NodeSimProps>, this.inputs.capacity ?? 1);
      // Free play as a simulation with no script of its own: the diagram's entry rates run while traffic is on.
      start = {
        id: "free-play",
        title: "Free play",
        seed: this.opts.seed ?? DEFAULT_SEED,
        scale: this.freeScale,
        durationMs: 60000,
        traffic: [],
        setup: { props: this.freeApplied },
        multipliers: { capacity: this.inputs.capacity ?? 1 },
      };
    }
    this.applySpeed();
    this.engine.setTraffic(this.traffic);
    // A new engine: a new origin, detached from anything that can change later, and an empty trail.
    this.runOrigin = deepFreeze(
      structuredClone({ diagram: this.diagram, simulation: start, initialTraffic: this.traffic }),
    );
    this.trail = [];
    this.invalidateVerification();
    this.tweaks = new Map();
    this.injector = createRealCountInjector(
      this.engine,
      (id) => this.diagram.nodes.find((n) => n.id === id),
      this.opts.roleOf ?? stencilRole,
      this.diagram.planning,
    );
    this.checkpoints = [];
    // A fresh engine reflects no logged op: whoever replays the log moves this on.
    this.applied = 0;
    this.captureCheckpoint(true);
    this.generation++;
    this.needsRestart = false;
    this.dirty = true;
    return "ok";
  }
}
