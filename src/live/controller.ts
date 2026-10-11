// The live view's model: one engine (free play) or one simulation run (a saved simulation), plus
// the playback state around it. Pure TypeScript with no DOM or React, so it is unit-tested directly.
// The UI drives it from requestAnimationFrame (`advance`) and reads `snapshot()` every frame;
// React components subscribe to `getState()`, which is republished at ~8 Hz while playing.

import type { DiagramFile, Simulation } from "../model/types";
import { createEngine } from "../sim/engine";
import { createSimulationRun } from "../sim/simulation";
import type {
  EngineOptions,
  InjectOptions,
  NodeSimProps,
  NodeStatus,
  SimEngine,
  SimSnapshot,
  SimulationRun,
  SimulationRunState,
} from "../sim/types";
import { DEFAULT_SEED } from "./storm";

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
/** Sim time one press of "step" advances. */
export const STEP_MS = 250;

/** A live, engine-only change ("Kill", "Slow down ×5"...), kept so it can be saved to the diagram. */
export interface NodeTweak {
  props: NodeSimProps;
  status?: NodeStatus;
}

export interface LiveState {
  playing: boolean;
  speed: number;
  traffic: boolean;
  /** The saved simulation being played, or null for free play. */
  simulation: Simulation | null;
  snapshot: SimSnapshot;
  run: SimulationRunState | null;
  tweaks: ReadonlyMap<string, NodeTweak>;
  /** Bumps whenever the engine is rebuilt (restart, new simulation, structural edit). */
  generation: number;
}

export type DiagramUpdate = "none" | "patched" | "reloaded";

/** Changes to these restart the engine; anything else (positions, groups, titles) doesn't touch it. */
export function structuralKey(d: DiagramFile): string {
  return JSON.stringify([
    d.nodes.map((n) => [n.id, n.stencil, n.label, n.sublabel ?? ""]),
    d.edges.map((e) => [e.id, e.from, e.to, e.kind ?? "async", e.props ?? null]),
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
}

export class LiveController {
  private diagram: DiagramFile;
  private sim: Simulation | null = null;
  private engine!: SimEngine;
  private runner: SimulationRun | null = null;
  private snap!: SimSnapshot;
  private runState: SimulationRunState | null = null;
  private dirty = true;
  private playing = false;
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
      this.dirty = false;
    }
    return this.snap;
  }

  getState = (): LiveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Rebuilds the published state and tells subscribers. Called by actions and the UI clock. */
  publish(): void {
    const snapshot = this.snapshot();
    this.state = {
      playing: this.playing,
      speed: this.speed,
      traffic: this.traffic,
      simulation: this.sim,
      snapshot,
      run: this.runState,
      tweaks: new Map(this.tweaks),
      generation: this.generation,
    };
    for (const l of this.listeners) l();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentDiagram(): DiagramFile {
    return this.diagram;
  }

  // ---------------------------------------------------------------- playback

  /** Advance by wall-clock ms (speed applies). No-op while paused, waiting on a note, or done. */
  advance(wallMs: number): void {
    if (!this.playing || !(wallMs > 0)) return;
    if (this.runner) {
      this.runner.step(wallMs);
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
    // A finished run plays again from the start.
    if (on && this.runState?.done) this.build();
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
    const wall = simMs / this.speed;
    if (this.runner) {
      if (this.runState?.waiting || this.runState?.done) return;
      this.runner.step(wall);
    } else this.engine.step(wall);
    this.dirty = true;
    this.publish();
  }

  /** Continue after a pausing note. */
  resume(): void {
    this.runner?.resume();
    this.dirty = true;
    this.publish();
  }

  /** Start over: same diagram, same simulation and seed; live tweaks are dropped. */
  restart(): void {
    this.build();
    this.publish();
  }

  /**
   * Jump to `targetMs` of the current simulation. Runs are seeded, so going back restarts and
   * fast-forwards deterministically. Pausing notes on the way are skipped.
   */
  seek(targetMs: number): void {
    if (!this.runner) return;
    const target = Math.max(0, targetMs);
    if (target < this.snapshot().time - 1) this.build();
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
      if (this.runner.state().time <= before && !this.runner.state().waiting) break;
    }
    this.dirty = true;
    this.publish();
  }

  /** Switch between free play (null) and a saved simulation. Rebuilds and keeps play / pause. */
  selectSimulation(sim: Simulation | null): void {
    this.sim = sim;
    this.build();
    this.publish();
  }

  // ---------------------------------------------------------------- live tweaks (engine only)

  inject(nodeId: string, count: number, opts?: InjectOptions): void {
    this.engine.inject(nodeId, count, opts);
    this.dirty = true;
    this.publish();
  }

  /** Injects at every node that has no incoming edges (the diagram's entry points). */
  injectAtSources(count: number): string[] {
    const targets = new Set(this.diagram.edges.map((e) => e.to));
    const sources = this.diagram.nodes
      .filter((n) => !targets.has(n.id) && this.diagram.edges.some((e) => e.from === n.id))
      .map((n) => n.id);
    for (const id of sources) this.engine.inject(id, count);
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
      const delta = Object.fromEntries(
        [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((p) => valueKey(after[p]) !== valueKey(before[p]))
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

  private rememberProps(d: DiagramFile): void {
    this.nodeProps = new Map(d.nodes.map((n) => [n.id, propsKey(n.props)]));
  }

  private build(): void {
    const engineOpts = { roleOf: this.opts.roleOf, maxParticles: this.opts.maxParticles };
    if (this.sim) {
      this.runner = createSimulationRun(this.diagram, this.sim, {
        ...engineOpts,
        seed: this.opts.seed ?? DEFAULT_SEED,
      });
      this.engine = this.runner.engine;
    } else {
      this.runner = null;
      this.engine = createEngine({ ...engineOpts, seed: this.opts.seed ?? DEFAULT_SEED });
      this.engine.load(this.diagram);
    }
    this.applySpeed();
    this.engine.setTraffic(this.traffic);
    this.tweaks.clear();
    this.generation++;
    this.dirty = true;
  }
}
