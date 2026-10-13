import type { DiagramFile, Expectation, Simulation } from "../model/types";
import { createSimulationRun } from "../sim/simulation";
import { toRealUnits } from "../sim/units";
import { buildContext, isBroker } from "./context";
import { findingOrder, runChecks } from "./run";
import { droppedFinding } from "./rules/dropped";
import type { Finding, FindingEvidence } from "./types";

// Simulation evidence (docs/research/architecture-checks.md, batch 5): Run simulations in the Checks card plays each
// saved simulation headless, counts the messages it loses, attaches those counts to the findings they bear out
// ("312 dropped in Payments goes down") and raises `dropped` for losses no other check explains.
//
// Bounded and deterministic. Each simulation plays at most 60 s of simulated time, in fixed 100 ms steps from its
// own seed, so the counts never depend on the machine or on how the work is sliced; the whole run stops at a
// wall-clock budget, and a simulation it cuts short is left out whole (never half-counted). It counts losses only:
// a saved simulation often overloads something on purpose to tell its story, and live's heat map is where that
// shows. Losses a simulation causes on purpose (at a node it takes down or makes fail, or that its own expectations
// count on) are reported as planned, never as findings. It runs in a worker (src/checks/evidenceWorker.ts).

export const EVIDENCE_LIMITS = {
  /** Simulated time each simulation plays, at most. */
  simulatedMs: 60_000,
  /** One step of a run: fixed, so slicing the work never changes a count. */
  stepMs: 100,
  /** Wall-clock time for all of them; simulations not finished by then aren't counted. */
  wallMs: 15_000,
} as const;

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
  /** down: it takes the node down (or pauses it); fails: it sets a failure rate there; expected: its expectations count on it. */
  why: "down" | "fails" | "expected";
}

export interface Evidence {
  /** The simulations played, in the file's order. */
  played: PlayedSimulation[];
  /** Titles of the simulations the time budget left out. */
  unplayed: string[];
  /** Counts for the checks' own findings (shown or ignored), by finding id. */
  byFinding: Record<string, FindingEvidence[]>;
  /** `dropped` findings: losses no other check explains (ignores aren't applied here; see withEvidence). */
  findings: Finding[];
  planned: PlannedLoss[];
}

export type EvidenceStep = { kind: "simulation"; index: number; total: number; title: string } | { kind: "slice" };

export interface EvidenceOptions {
  /** The clock for the wall-time budget (tests pass their own). */
  now?: () => number;
  wallMs?: number;
  /** Steps between looks at the clock, each a `slice` the caller may yield at. */
  sliceSteps?: number;
}

/** Real-unit counts at each node with any, for one simulation. */
interface Counts {
  sim: Simulation;
  played: PlayedSimulation;
  dropped: Map<string, number>;
  unread: Map<string, number>;
  /** Nodes that failed anything (to say which consumers a broker's losses came from). */
  failed: Set<string>;
}

const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Whether an expectation counts on a positive value (`> 0`, `>= 5`, `== 30`): the loss is the story. */
const expectsSome = (e: Expectation) =>
  (e.op === ">" && e.value >= 0) || ((e.op === ">=" || e.op === "==") && e.value > 0);

/** Whether an expectation says nothing is lost (`== 0`, `< 1`, `<= 0`): a loss there is news, whatever else it does. */
const expectsNone = (e: Expectation) =>
  (e.op === "==" && e.value === 0) || (e.op === "<" && e.value <= 1) || (e.op === "<=" && e.value < 1);

/**
 * Why `sim` loses messages at `node` on purpose, or undefined when it doesn't mean to. `broken`: whether taking the
 * node down or making it fail counts (it does where the loss happens at the node itself, not at a broker).
 */
function onPurpose(
  diagram: DiagramFile,
  sim: Simulation,
  node: string,
  fields: readonly string[],
  broken: boolean,
): PlannedLoss["why"] | undefined {
  const about = (sim.expectations ?? []).filter(
    (e) => "node" in e.metric && e.metric.node === node && fields.includes(e.metric.field),
  );
  if (about.some(expectsNone)) return undefined;
  const stopped = (s: unknown) => s === "down" || s === "paused";
  const timeline = sim.timeline ?? [];
  if (
    broken &&
    (stopped(sim.setup?.status?.[node]) ||
      stopped(diagram.nodes.find((n) => n.id === node)?.props?.status) ||
      timeline.some(({ action: a }) => a.do === "status" && a.node === node && stopped(a.status)))
  )
    return "down";
  if (
    broken &&
    (positive(sim.setup?.props?.[node]?.failureRate) ||
      timeline.some(({ action: a }) => a.do === "props" && a.node === node && positive(a.props.failureRate)))
  )
    return "fails";
  return about.some(expectsSome) ? "expected" : undefined;
}

/**
 * Plays one simulation to its end or the 60 s cap, yielding a slice every `sliceSteps` steps. Returns undefined
 * when the clock passes `deadline` first: a simulation cut short by the wall clock isn't counted at all.
 */
function* play(
  diagram: DiagramFile,
  sim: Simulation,
  watch: readonly string[],
  now: () => number,
  deadline: number,
  sliceSteps: number,
): Generator<EvidenceStep, Counts | undefined, void> {
  const run = createSimulationRun(diagram, sim);
  run.setTraceActions(false);
  const cap = EVIDENCE_LIMITS.simulatedMs;
  // Pausing notes are resumed at once; each is passed once, so the run always moves on.
  const maxSteps = Math.ceil(cap / EVIDENCE_LIMITS.stepMs) + (sim.timeline?.length ?? 0) + 1;
  let state = run.state();
  for (let steps = 0; !state.done && state.time < cap && steps < maxSteps;) {
    if (state.waiting) run.resume();
    else {
      run.step(EVIDENCE_LIMITS.stepMs);
      if (++steps % sliceSteps === 0) {
        if (now() > deadline) return undefined;
        yield { kind: "slice" };
      }
    }
    state = run.state();
  }
  const scale = state.scale ?? 1;
  const real = (v: number | undefined) => Math.round(toRealUnits(v ?? 0, scale));
  const dropped = new Map<string, number>();
  const failed = new Set<string>();
  for (const n of diagram.nodes) {
    const count = real(run.engine.measure({ node: n.id, field: "dropped" }));
    if (count > 0) dropped.set(n.id, count);
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
 * Plays every saved simulation of `diagram` and works out what they show. A generator: it yields at the start of
 * each simulation (for "Playing 2 of 5…") and between slices of work, and returns the evidence. A caller that stops
 * pulling has cancelled it. The same diagram always gives the same evidence (within the wall-clock budget).
 */
export function* gatherEvidence(diagram: DiagramFile, opts: EvidenceOptions = {}): Generator<EvidenceStep, Evidence> {
  const now = opts.now ?? (() => performance.now());
  const deadline = now() + (opts.wallMs ?? EVIDENCE_LIMITS.wallMs);
  const sliceSteps = Math.max(1, Math.floor(opts.sliceSteps ?? 10));
  const sims = diagram.simulations ?? [];
  const checks = runChecks(diagram);
  const known = new Map([...checks.findings, ...checks.ignored].map((f) => [f.id, f]));
  // The queues and topics a finding says nobody reads: what's left in them at the end is evidence too.
  const watch = [...known.values()].filter((f) => f.rule === "no-reader").map((f) => f.target);

  const runs: Counts[] = [];
  const unplayed: string[] = [];
  let outOfTime = false;
  for (const [i, sim] of sims.entries()) {
    if (!outOfTime) {
      yield { kind: "simulation", index: i + 1, total: sims.length, title: sim.title };
      const counts = yield* play(diagram, sim, watch, now, deadline, sliceSteps);
      if (counts) runs.push(counts);
      else outOfTime = true;
    }
    if (outOfTime) unplayed.push(sim.title);
  }

  const ctx = buildContext(diagram);
  const off = new Set(diagram.checks?.off ?? []);
  const byFinding: Record<string, FindingEvidence[]> = {};
  const droppedAt = new Map<string, FindingEvidence[]>();
  /** The consumers whose failures a broker lost, across the simulations that lost them there. */
  const failing = new Map<string, Set<string>>();
  const planned: PlannedLoss[] = [];
  const add = (map: Map<string, FindingEvidence[]>, key: string, e: FindingEvidence) => {
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  };
  const attach = (id: string, e: FindingEvidence) => (byFinding[id] ??= []).push(e);

  for (const { sim, played, dropped, unread, failed } of runs) {
    const evidence = (what: FindingEvidence["what"], count: number): FindingEvidence => ({
      simulation: sim.title,
      what,
      count,
      ...(played.capped ? { capped: true } : {}),
    });
    for (const [node, count] of dropped) {
      const e = evidence("dropped", count);
      const broker = isBroker(ctx, node);
      // At a broker the loss is the design's (messages that ran out of deliveries had nowhere to go), unless the
      // simulation's expectations count on it; at any other node, a simulation that breaks it means to lose there.
      const why = onPurpose(diagram, sim, node, ["dropped"], !broker);
      const finding = broker ? `dead-letter:${node}` : `single-point:${node}`;
      if (known.has(finding)) attach(finding, e);
      else if (why) planned.push({ node, simulation: sim.title, what: "dropped", count, why });
      // Turned off, dead-letter's losses stay quiet: `dropped` would raise what the person turned off.
      else if (!(broker && off.has("dead-letter"))) {
        add(droppedAt, node, e);
        const set = failing.get(node) ?? new Set<string>();
        for (const r of ctx.routes(node)) if (failed.has(r.to)) set.add(r.to);
        failing.set(node, set);
      }
    }
    for (const [node, count] of unread) {
      const why = onPurpose(diagram, sim, node, ["backlog", "lag"], false);
      if (why) planned.push({ node, simulation: sim.title, what: "unread", count, why });
      else attach(`no-reader:${node}`, evidence("unread", count));
    }
  }
  const findings = off.has("dropped")
    ? []
    : [...droppedAt]
        .map(([node, list]) => droppedFinding(ctx, node, list, [...(failing.get(node) ?? [])]))
        .sort(findingOrder(ctx.rank));
  return { played: runs.map((r) => r.played), unplayed, byFinding, findings, planned };
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
