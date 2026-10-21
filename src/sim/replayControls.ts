import type { DiagramFile, Simulation } from "../model/types";
import type { Fault } from "../model/faults";
import type { InjectOptions, NodeSimProps, NodeStatus, SimEngine, SimulationRun } from "./types";

// The replay contract shared by live playback and headless verification (PR #225).
//
// The live controller applies every change it makes to a running engine through `dispatchReplayControl`, and keeps
// what it applied, in order and with the simulation time it applied it at, as the run's trail. A headless replay of
// that trail (src/sim/headless.ts) starts from the same origin and dispatches the same controls at the same times
// through this same function, so a same-seed rerun reproduces the run the person watched:
//
// - at each boundary, the controls due by now apply first, in their recorded order (Continue included);
// - only then is a pausing note that still waits passed automatically (a replay never stops for narration);
// - the run never steps past the next control's time.

/** One change to a running engine, as the live run made it. */
export type ReplayControl =
  /** Continue after a pausing note: same-time timeline actions behind the note run now, in order with the rest. */
  | { kind: "resume" }
  | { kind: "traffic"; on: boolean }
  | { kind: "inject"; node: string; count: number; opts?: InjectOptions }
  | { kind: "sendOne"; node: string; type?: string }
  | { kind: "fault"; fault: Fault }
  | { kind: "status"; node: string; status: NodeStatus }
  | { kind: "props"; node: string; patch: NodeSimProps }
  /**
   * An input or diagram change patched into the running engine without a rebuild (Inputs & capacity, a saved
   * simulation's props, a diagram property edit, Save): statuses, then props (with the engine's Capacity × when
   * set), then a saved simulation's multipliers.
   */
  | {
      kind: "configuration";
      statuses?: Record<string, NodeStatus>;
      patches: Record<string, NodeSimProps>;
      capacity?: number;
      multipliers?: { traffic: number; capacity: number };
    };

export interface TimedReplayControl {
  /** Simulation ms it applied at (a whole number of engine ticks). */
  readonly time: number;
  readonly op: ReplayControl;
}

/** Where a run started: what its engine was built from, before any control. */
export interface VerificationOrigin {
  readonly diagram: DiagramFile;
  /** Resolved: its seed and dot scale are the ones the run used. Free play is described as a simulation too. */
  readonly simulation: Simulation;
  /** The traffic switch the engine was built with. */
  readonly initialTraffic: boolean;
}

/**
 * Everything a same-seed replay needs to reproduce a live run: its origin and the controls applied since, in order.
 * Immutable and detached; `revision` increases with every change to either, so a result is stale when it differs.
 */
export interface VerificationContext {
  readonly revision: number;
  readonly origin: VerificationOrigin;
  readonly controls: readonly TimedReplayControl[];
}

/** What a control acts on: the engine, and the run (or free play's injector) around it. */
export interface ReplayTarget {
  engine: SimEngine;
  resume(): void;
  /** Real messages, sampled at the run's dot scale (fractions carry over, as live). */
  inject(node: string, count: number, opts?: InjectOptions): void;
  setMultipliers?: SimulationRun["setMultipliers"];
}

/** Applies one control. Live playback, scrubbing, rebuilds and verification all apply controls only through here. */
export function dispatchReplayControl(op: ReplayControl, target: ReplayTarget): void {
  const { engine } = target;
  switch (op.kind) {
    case "resume":
      return target.resume();
    case "traffic":
      return engine.setTraffic(op.on);
    case "inject":
      return target.inject(op.node, op.count, op.opts);
    case "sendOne":
      return engine.inject(op.node, 1, op.type ? { type: op.type } : undefined);
    case "fault":
      return engine.setFault(op.fault);
    case "status":
      return engine.setNodeStatus(op.node, op.status);
    case "props":
      return engine.setNodeProps(op.node, op.patch);
    case "configuration":
      for (const [id, status] of Object.entries(op.statuses ?? {})) engine.setNodeStatus(id, status);
      engine.setNodePropsBatch(op.patches, op.capacity);
      if (op.multipliers) target.setMultipliers?.(op.multipliers);
      return;
    default: {
      const unknown: never = op;
      return unknown;
    }
  }
}

/** Applies the controls due by `now` (time ≤ now) from `cursor`, in order; returns the next cursor. */
export function applyDue<T extends { time: number }>(
  entries: readonly T[],
  cursor: number,
  now: number,
  apply: (entry: T) => void,
): number {
  while (cursor < entries.length && entries[cursor].time <= now) apply(entries[cursor++]);
  return cursor;
}

/** Simulation ms until the next control (Infinity when none): a step never runs past it. */
export function untilDue(entries: readonly { time: number }[], cursor: number, now: number): number {
  return cursor < entries.length ? entries[cursor].time - now : Infinity;
}

/** Frozen all the way down. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
