import type { Fault } from "../model/faults";
import type { Simulation } from "../model/types";
import type { InjectOptions, NodeSimProps, NodeStatus } from "../sim/types";
import { SIM_TICK_MS } from "../sim/scheduler";
import type { LiveInputs } from "./capacityModel";

// The live run's control log (shared Live design, P1). Every change to a running simulation goes through
// `LiveController.apply`, which stamps it with the simulation tick it lands on and appends it here:
// `{ run, seq, tick, op }`. The engine applies each op on that exact tick, so a scrub back or a rebuild replays
// the run with its live tweaks where they were, and a follower (P2) can apply the same ops on the same ticks.
//
// Tweaks stay run-only: nothing here writes the document. Only Save to diagram and Apply fix do, as before.

/** Simulation time of a tick (the engine's fixed step, src/sim/scheduler.ts). */
export const tickTime = (tick: number) => tick * SIM_TICK_MS;
/** The tick a simulation time falls on (live time is always a whole number of ticks). */
export const timeTick = (ms: number) => Math.round(ms / SIM_TICK_MS);

export type LiveOp =
  // Playback: they change when ticks run, never what a tick does.
  | { kind: "play"; on: boolean }
  | { kind: "speed"; speed: number }
  | { kind: "step"; simMs: number }
  | { kind: "seek"; targetMs: number }
  | { kind: "restart" }
  | { kind: "select"; simulation: Simulation | null }
  // A pausing note is passed: ordered with the tweaks made while it waited.
  | { kind: "resume" }
  // The Inputs & capacity panel and the saved definition: they rewrite the run's history (a rebuild replays the
  // run with them from the start), so a replay never applies them again.
  | { kind: "inputs"; inputs: LiveInputs }
  | { kind: "base"; simulation: Simulation }
  // Inputs saved: the saved simulation becomes the base (null: free play), and the diagram's node props (by node id)
  // when the save wrote them; the what-ifs are cleared.
  | { kind: "commit"; simulation: Simulation | null; props?: Record<string, Record<string, unknown>> }
  // A diagram edit the running engine took: a props patch (with the edited nodes' props as the diagram now has
  // them), or a structural change that restarted it.
  | {
      kind: "patch";
      patches: Record<string, NodeSimProps>;
      statuses: Record<string, NodeStatus>;
      nodes?: Record<string, Record<string, unknown>>;
    }
  | { kind: "reload" }
  // Engine tweaks: what a tick does from here on. A replay applies these again on their tick.
  | { kind: "traffic"; on: boolean }
  | { kind: "inject"; node: string; count: number; opts?: InjectOptions }
  | { kind: "injectSources"; count: number }
  | { kind: "sendOne"; node: string; type?: string }
  | { kind: "fault"; fault: Fault }
  | { kind: "status"; node: string; status: NodeStatus }
  | { kind: "props"; node: string; patch: NodeSimProps };

export type LiveOpKind = LiveOp["kind"];

/**
 * Who changed the run: this person ("user"), the room's host through Watch together ("remote", src/collab/room), or
 * the editor's document catching up with the run ("sync": a saved simulation edited or removed, a diagram edit).
 * Only this person's own changes end following someone else's run.
 */
export type OpOrigin = "user" | "remote" | "sync";

export interface LogEntry {
  /** The run this op belongs to: a restart, another simulation or a structural edit starts a new one. */
  readonly run: number;
  /** Order within the run, from 1 (ops on one tick apply in this order). */
  readonly seq: number;
  /** The tick it landed on: it applies after that tick ran, before the next. */
  readonly tick: number;
  readonly op: LiveOp;
}

/** Ops a replay applies again on their tick: what changes a tick's outcome without rewriting the run. */
export const REPLAYED: ReadonlySet<LiveOpKind> = new Set<LiveOpKind>([
  "resume",
  "traffic",
  "inject",
  "injectSources",
  "sendOne",
  "fault",
  "status",
  "props",
]);

export const replayed = (entry: LogEntry) => REPLAYED.has(entry.op.kind);

/** Frozen all the way down: what the log keeps can't change after it's logged, through any reader. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** The log's own copy of an op: the caller may change its objects afterwards without changing history. */
export const own = (op: LiveOp): LiveOp => freeze(structuredClone(op));
