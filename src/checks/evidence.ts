import type { DiagramFile, Expectation, Simulation, TrafficShape } from "../model/types";
import { createSimulationRun } from "../sim/simulation";
import { SIM_TICK_MS } from "../sim/scheduler";
import { resolveMultiplier, resolveScale, toRealUnits } from "../sim/units";
import { buildContext, isBroker, type CheckContext } from "./context";
import { findingOrder, runChecks } from "./run";
import { droppedFinding } from "./rules/dropped";
import type { Finding, FindingEvidence } from "./types";
import { EVIDENCE_LIMITS } from "./evidenceLimits";

// Simulation evidence (docs/research/architecture-checks.md, batch 5): Run simulations in the Checks card plays each
// saved simulation headless and counts the messages it loses. This file only plays and counts; what a count means (a
// finding it bears out, a `dropped` finding, a loss on purpose) is decided against the checks as they are when it's
// shown (./evidenceMerge.ts), so turning a check off or on, or ignoring one, never needs another run.
//
// Bounded and deterministic. Each simulation plays at most 60 s of simulated time, one 10 ms engine tick at a time from
// its own seed, so the counts never depend on the machine or on how the work is sliced. A simulation whose traffic
// would start more work than a bound allows isn't played at all (a hostile file can ask for billions of copies in one
// tick), and the whole run stops at a wall-clock budget, checked before, during and after each simulation: one the
// budget cuts short or that ends after it is left out whole. It counts losses only: a saved simulation often overloads
// something on purpose to tell its story, and live's heat map is where that shows. It runs in a worker
// (src/checks/evidenceWorker.ts).

export { EVIDENCE_LIMITS };

export interface PlayedSimulation {
  id: string;
  title: string;
  /** Simulated time played, ms. */
  playedMs: number;
  /** Stopped at the 60 s cap before it ended. */
  capped: boolean;
}

/** A loss the simulation causes on purpose: counted, never a finding. */
export interface PlannedLoss {
  node: string;
  simulation: string;
  what: FindingEvidence["what"];
  count: number;
  /** down: it had the node down (or paused); fails: it had it failing; expected: its expectations count on it. */
  why: "down" | "fails" | "expected";
}

/** One simulation's losses at one node, in real messages: raw counts, before anything decides what they mean. */
export interface Loss {
  simulation: string;
  /** The simulation was stopped at the 60 s cap: the count is for its first minute. */
  capped?: true;
  node: string;
  /** Whether the node is a queue, topic or stream (a loss there is messages that ran out of deliveries). */
  broker: boolean;
  what: FindingEvidence["what"];
  count: number;
  /** Of `count`, what was lost while the simulation itself had the node down or failing (its played timeline). */
  onPurpose?: { count: number; why: "down" | "fails" };
  /** The simulation's own expectations about this: "some" count on a loss here, "none" say there's none. */
  expects?: "some" | "none";
}

export interface Evidence {
  /** The simulations played, in the file's order. */
  played: PlayedSimulation[];
  /** Titles of the simulations the time budget left out. */
  unplayed: string[];
  /** Titles of the simulations that would start too much work to play here. */
  tooBig: string[];
  losses: Loss[];
  /**
   * The `dropped` finding for each node that lost messages the simulation didn't mean to lose, in reading order,
   * without counts: whether it shows depends on the checks as they are (see withEvidence).
   */
  dropped: Finding[];
}

export type EvidenceStep = { kind: "simulation"; index: number; total: number; title: string } | { kind: "slice" };

export interface EvidenceOptions {
  /** The clock for the wall-time budget (tests pass their own). */
  now?: () => number;
  wallMs?: number;
  /** Engine ticks between looks at the clock, each a `slice` the caller may yield at. */
  sliceTicks?: number;
  /** See EVIDENCE_LIMITS.startWork (the main thread, where there's no worker, allows less). */
  startWork?: number;
}

const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
const stopped = (s: unknown) => s === "down" || s === "paused";

/** Whether an expectation counts on a positive value (`> 0`, `>= 5`, `== 30`): the loss is the story. */
const expectsSome = (e: Expectation) =>
  (e.op === ">" && e.value >= 0) || ((e.op === ">=" || e.op === "==") && e.value > 0);
/** Whether an expectation says nothing is lost (`== 0`, `< 1`, `<= 0`): a loss there is news, whatever else it does. */
const expectsNone = (e: Expectation) =>
  (e.op === "==" && e.value === 0) || (e.op === "<" && e.value <= 1) || (e.op === "<=" && e.value < 1);

function expectations(sim: Simulation, node: string, fields: readonly string[]): Loss["expects"] {
  const about = (sim.expectations ?? []).filter(
    (e) => "node" in e.metric && e.metric.node === node && fields.includes(e.metric.field),
  );
  return about.some(expectsNone) ? "none" : about.some(expectsSome) ? "some" : undefined;
}

/** Messages a traffic shape sends, in all. */
function messages(shape: TrafficShape): number {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  switch (shape.kind) {
    case "burst":
      return n(shape.count);
    case "constant":
      return (n(shape.ratePerSec) * n(shape.durationMs)) / 1000;
    case "spike":
      return (Math.max(n(shape.baseRate), n(shape.peakRate)) * n(shape.durationMs)) / 1000;
    case "ramp": {
      let total = 0;
      let previous = n(shape.startRate);
      for (const stage of shape.stages) {
        total += (Math.max(previous, n(stage.targetRate)) * n(stage.durationMs)) / 1000;
        previous = n(stage.targetRate);
      }
      return total;
    }
  }
}

/**
 * The most work a simulation can start: the sampled messages its traffic and timeline inject, times the most routes
 * any node sends a copy down. Worked out from the file alone, before the engine allocates anything.
 */
export function startWork(sim: Simulation, ctx: CheckContext): number {
  let widest = 1;
  for (const routes of ctx.topology.outgoing.values()) widest = Math.max(widest, routes.length);
  let sent = sim.traffic.reduce((sum, p) => sum + messages(p.shape), 0);
  for (const { action } of sim.timeline ?? []) if (action.do === "inject") sent += Math.max(0, action.count || 0);
  const sampled = (sent * Math.max(1, resolveMultiplier(sim.multipliers?.traffic))) / resolveScale(sim.scale);
  return Number.isFinite(sampled) ? sampled * widest : Infinity;
}

/** What the simulation does to a node it breaks, as its timeline plays: the state each tick's losses happened in. */
interface Breakage {
  down: boolean;
  fails: boolean;
}

/** The nodes `sim` takes down or makes fail (or that the diagram has down), with their state at time 0. */
function breakable(diagram: DiagramFile, sim: Simulation): Map<string, Breakage> {
  const out = new Map<string, Breakage>();
  const at = (id: string) => {
    let b = out.get(id);
    if (!b) out.set(id, (b = { down: false, fails: false }));
    return b;
  };
  for (const n of diagram.nodes) if (stopped(n.props?.status)) at(n.id).down = true;
  for (const [id, status] of Object.entries(sim.setup?.status ?? {})) at(id).down = stopped(status);
  for (const [id, props] of Object.entries(sim.setup?.props ?? {}))
    if (positive(props?.failureRate)) at(id).fails = true;
  for (const { action: a } of sim.timeline ?? []) {
    if (a.do === "status") at(a.node);
    if (a.do === "props" && "failureRate" in a.props) at(a.node);
  }
  return out;
}

interface Counts {
  sim: Simulation;
  played: PlayedSimulation;
  /** Per node: all of it, and what was lost while the simulation had the node down or failing. */
  dropped: Map<string, { count: number; down: number; fails: number }>;
  unread: Map<string, number>;
  /** Nodes that failed anything (to say which consumers a broker's losses came from). */
  failed: Set<string>;
}

type Clock = { now: () => number; deadline: number; sliceTicks: number };

/**
 * Plays one simulation to its end or the 60 s cap, a tick at a time, yielding a slice every `sliceTicks` ticks.
 * Returns undefined when the clock passes the deadline first, or the simulation ends after it: it isn't counted.
 */
function* play(
  diagram: DiagramFile,
  sim: Simulation,
  watch: readonly string[],
  clock: Clock,
): Generator<EvidenceStep, Counts | undefined, void> {
  const run = createSimulationRun(diagram, sim);
  run.setTraceActions(false);
  if (clock.now() > clock.deadline) return undefined;
  const cap = EVIDENCE_LIMITS.simulatedMs;
  // The simulation's own breakage, replayed alongside: which of each tick's losses it meant (only actions it played).
  const breaks = breakable(diagram, sim);
  const timeline = [...(sim.timeline ?? [])].sort((a, b) => a.atMs - b.atMs);
  let cursor = 0;
  const apply = (time: number) => {
    for (; cursor < timeline.length && timeline[cursor].atMs <= time; cursor++) {
      const a = timeline[cursor].action;
      const b = a.do === "status" || a.do === "props" ? breaks.get(a.node) : undefined;
      if (!b) continue;
      if (a.do === "status") b.down = stopped(a.status);
      else if (a.do === "props" && "failureRate" in a.props) b.fails = positive(a.props.failureRate);
    }
  };
  apply(0);
  const lost = new Map<string, { last: number; down: number; fails: number }>();
  for (const id of breaks.keys()) lost.set(id, { last: 0, down: 0, fails: 0 });
  // Pausing notes are resumed at once; each is passed once, so the run always moves on.
  const maxTicks = Math.ceil(cap / SIM_TICK_MS) + timeline.length + 1;
  let state = run.state();
  for (let ticks = 0; !state.done && state.time < cap && ticks < maxTicks;) {
    if (state.waiting) run.resume();
    else {
      run.step(SIM_TICK_MS);
      for (const [id, l] of lost) {
        const now = run.engine.measure({ node: id, field: "dropped" }) ?? 0;
        const b = breaks.get(id)!;
        if (now > l.last && b.down) l.down += now - l.last;
        else if (now > l.last && b.fails) l.fails += now - l.last;
        l.last = now;
      }
      if (++ticks % clock.sliceTicks === 0) {
        if (clock.now() > clock.deadline) return undefined;
        yield { kind: "slice" };
      }
    }
    state = run.state();
    apply(state.time);
  }
  if (clock.now() > clock.deadline) return undefined;
  const scale = state.scale ?? 1;
  const real = (v: number | undefined) => Math.round(toRealUnits(v ?? 0, scale));
  const dropped: Counts["dropped"] = new Map();
  const failed = new Set<string>();
  for (const n of diagram.nodes) {
    const count = real(run.engine.measure({ node: n.id, field: "dropped" }));
    const l = lost.get(n.id);
    if (count > 0) dropped.set(n.id, { count, down: real(l?.down), fails: real(l?.fails) });
    if ((run.engine.measure({ node: n.id, field: "failed" }) ?? 0) > 0) failed.add(n.id);
  }
  const unread = new Map<string, number>();
  for (const id of watch) {
    const count = real(run.engine.measure({ node: id, field: "backlog" }));
    if (count > 0) unread.set(id, count);
  }
  return {
    sim,
    played: { id: sim.id, title: sim.title, playedMs: state.time, capped: !state.done && state.time >= cap },
    dropped,
    unread,
    failed,
  };
}

/**
 * Plays every saved simulation of `diagram` and counts what they lose. A generator: it yields at the start of each
 * simulation (for "Playing 2 of 5…") and between slices of work, and returns the counts. A caller that stops pulling
 * has cancelled it. The same diagram always gives the same counts (within the wall-clock budget).
 */
export function* gatherEvidence(diagram: DiagramFile, opts: EvidenceOptions = {}): Generator<EvidenceStep, Evidence> {
  const now = opts.now ?? (() => performance.now());
  const clock: Clock = {
    now,
    deadline: now() + (opts.wallMs ?? EVIDENCE_LIMITS.wallMs),
    sliceTicks: Math.max(1, Math.floor(opts.sliceTicks ?? EVIDENCE_LIMITS.sliceTicks)),
  };
  const limit = opts.startWork ?? EVIDENCE_LIMITS.startWork;
  const sims = diagram.simulations ?? [];
  const ctx = buildContext(diagram);
  // What each check would find with every check on: the counts are kept for all of them, so turning one on later
  // shows its counts without another run. Queues nobody reads are watched for what's left in them.
  const all = runChecks({ ...diagram, checks: undefined });
  const watch = all.findings.filter((f) => f.rule === "no-reader").map((f) => f.target);

  const runs: Counts[] = [];
  const unplayed: string[] = [];
  const tooBig: string[] = [];
  let outOfTime = false;
  for (const [i, sim] of sims.entries()) {
    outOfTime ||= clock.now() > clock.deadline;
    if (outOfTime) {
      unplayed.push(sim.title);
      continue;
    }
    yield { kind: "simulation", index: i + 1, total: sims.length, title: sim.title };
    if (startWork(sim, ctx) > limit) {
      tooBig.push(sim.title);
      continue;
    }
    const counts = yield* play(diagram, sim, watch, clock);
    if (counts) runs.push(counts);
    else {
      outOfTime = true;
      unplayed.push(sim.title);
    }
  }

  const losses: Loss[] = [];
  /** Nodes with losses a simulation didn't mean, and the consumers that failed there. */
  const unmeant = new Map<string, Set<string>>();
  for (const { sim, played, dropped, unread, failed } of runs) {
    const capped = played.capped ? ({ capped: true } as const) : {};
    for (const [node, d] of dropped) {
      const broker = isBroker(ctx, node);
      const expects = expectations(sim, node, ["dropped"]);
      const purpose = d.down
        ? { count: d.down, why: "down" as const }
        : d.fails
          ? { count: d.fails, why: "fails" as const }
          : undefined;
      losses.push({
        simulation: sim.title,
        ...capped,
        node,
        broker,
        what: "dropped",
        count: d.count,
        ...(purpose ? { onPurpose: purpose } : {}),
        ...(expects ? { expects } : {}),
      });
      if (expects !== "some" && (expects === "none" || d.count > (purpose?.count ?? 0))) {
        const set = unmeant.get(node) ?? new Set<string>();
        if (broker) for (const r of ctx.routes(node)) if (failed.has(r.to)) set.add(r.to);
        unmeant.set(node, set);
      }
    }
    for (const [node, count] of unread) {
      const expects = expectations(sim, node, ["backlog", "lag"]);
      losses.push({
        simulation: sim.title,
        ...capped,
        node,
        broker: true,
        what: "unread",
        count,
        ...(expects ? { expects } : {}),
      });
    }
  }
  const dropped = [...unmeant]
    .map(([node, failing]) => droppedFinding(ctx, node, [], [...failing]))
    .sort(findingOrder(ctx.rank));
  return { played: runs.map((r) => r.played), unplayed, tooBig, losses, dropped };
}

/** Plays them all at once (the worker's way, and tests'). */
export function collectEvidence(
  diagram: DiagramFile,
  opts: EvidenceOptions = {},
  onStep?: (step: EvidenceStep) => void,
): Evidence {
  const it = gatherEvidence(diagram, opts);
  for (;;) {
    const next = it.next();
    if (next.done) return next.value;
    onStep?.(next.value);
  }
}
