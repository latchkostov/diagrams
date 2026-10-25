import { defineMachine, type Transition } from "../lib/machine";

/**
 * The step runner (docs/QUALITY.md, "Lifecycles with modes"). Pure: the runner (./runner.ts) sends it what the
 * sandbox shows and what the learner presses, and executes the commands it returns.
 *
 *   intro ──start──▶ step n ──(its check holds and the learner has finished)──▶ step n+1 … ──▶ finished
 *                    step n is one of: active ──showMe──▶ hinting
 *                                      active | hinting ──(check holds, learner still at it)──▶ completing
 *   any ──exit──▶ closed        step | finished ──restart──▶ active (step 1)        step ──skip──▶ (done for you)
 *
 * The current step is always the first step not held. A step is held once its check holds *and* it has settled (the
 * editor's mode says the learner has finished: a name typed and Entered, not half typed), or for good once a sticky
 * step's check has held or it was skipped. So Undo goes back a step by itself, a step already done (the "+" also
 * connects) is passed over, and leaving Live while watching traffic goes back to "Go live". `completing` is the
 * moment between: the check holds, the strip says so, and the step waits for the learner to finish, never for a timer.
 */
export type RunnerPhase = "intro" | "reconstructing" | "active" | "hinting" | "completing" | "finished" | "closed";
/**
 * The current step's `sinceStep` readings, by expression (checks.ts, baselineKey): the value and the Live run's
 * generation it was read in. Read once the step is current, each as soon as Live shows it; never for another step.
 */
export type Baseline = Readonly<Record<string, readonly [value: number, generation: number]>>;
export interface RunnerState {
  value: RunnerPhase;
  /** The current step (intro: where Start begins; finished: the last). */
  index: number;
  /** Each step's check, as last observed. */
  observed: readonly boolean[];
  /** Whether the learner has finished what each step's check is about (the editor's mode). */
  settled: readonly boolean[];
  /** Sticky steps whose check held once, or that were skipped. */
  latched: readonly boolean[];
  /** From the definition: which steps latch. */
  sticky: readonly boolean[];
  /** Which steps have an edit to perform on Skip, independently of whether their completion is sticky. */
  demos: readonly boolean[];
  /** The step done most recently, for its "done" words. */
  last: number | null;
  highlights: boolean;
  /** Saved progress: the step this tutorial was left at, or 0. */
  resumeAt: number;
  stepIds: readonly string[];
  /**
   * Entering a step (Start, moving on or back, Continue's handover) empties it; so do Skip and Restart. Kept in the
   * state rather than beside it, so the runner reconnecting or rebuilding its subjects never loses or re-reads it.
   */
  baseline: Baseline;
}
export type RunnerEvent =
  /** fix: a near miss's one-click fix ("Use Orders API"): the step's own demo, as Skip does it. */
  | { type: "start" | "resume" | "reconstructed" | "showMe" | "fix" | "restart" | "exit" }
  | { type: "skip"; stepId: string }
  | { type: "observe"; met: readonly boolean[]; settled: readonly boolean[] }
  /** Readings for the current step's baseline; only those it doesn't have yet are kept. */
  | { type: "baseline"; step: number; values: Baseline }
  | { type: "highlights"; on: boolean };
export type RunnerCommand =
  /** Do these steps for the learner, in order, each once its predecessors' changes have landed. */
  | { type: "demo"; steps: readonly number[] }
  /** Restore saved predecessors, settling their naming before handing control to the learner. */
  | { type: "reconstruct"; steps: readonly number[] }
  /** Put the starting diagram back and leave Live. */
  | { type: "reset" }
  /** Bring the current step's target into view (through the canvas's own camera and focus paths). */
  | { type: "reveal"; step: number }
  | { type: "announce"; step: number | "finished" }
  | { type: "save"; step: number; completed: boolean }
  | { type: "prefs"; highlights: boolean }
  | { type: "close" };

const STEP_STATES = ["active", "hinting", "completing"] as const;
export const inStep = (s: RunnerState) => (STEP_STATES as readonly string[]).includes(s.value);

export function runnerInitial(
  sticky: readonly boolean[],
  opts: { highlights: boolean; resumeAt: number; stepIds?: readonly string[]; demos?: readonly boolean[] },
): RunnerState {
  const none = sticky.map(() => false);
  return {
    stepIds: opts.stepIds ?? sticky.map((_, i) => String(i)),
    value: "intro",
    index: 0,
    observed: none,
    settled: none,
    latched: none,
    sticky,
    demos: opts.demos ?? sticky.map((on) => !on),
    last: null,
    highlights: opts.highlights,
    resumeAt: Math.max(0, Math.min(opts.resumeAt, sticky.length - 1)),
    baseline: {},
  };
}

type Facts = Pick<RunnerState, "observed" | "settled" | "latched">;
const held = (s: Facts, i: number) => s.latched[i] || (s.observed[i] && s.settled[i]);
/** The first step not held, or the step count when all are. */
export const firstOpen = (s: Facts): number => {
  const i = s.observed.findIndex((_, n) => !held(s, n));
  return i < 0 ? s.observed.length : i;
};
const latchSeen = (s: RunnerState, met: readonly boolean[]) => s.latched.map((on, i) => on || (s.sticky[i] && met[i]));

/** Where the facts put the pointer, and in which step state. */
function position(s: RunnerState, facts: Facts): RunnerState {
  const index = firstOpen(facts);
  const n = s.observed.length;
  if (index === n) return { ...s, ...facts, value: "finished", index: n - 1, last: n - 1, baseline: {} };
  const moved = index !== s.index || !inStep(s);
  return {
    ...s,
    ...facts,
    index,
    baseline: moved ? {} : s.baseline,
    value: facts.observed[index] ? "completing" : !moved && s.value === "hinting" ? "hinting" : "active",
    last: index > s.index ? index - 1 : moved && index < s.index ? null : s.last,
  };
}
const observed = (s: RunnerState, e: RunnerEvent) =>
  e.type === "observe" ? position(s, { observed: e.met, settled: e.settled, latched: latchSeen(s, e.met) }) : s;
const fits = (s: RunnerState, e: RunnerEvent) =>
  e.type === "observe" && e.met.length === s.observed.length && e.settled.length === s.observed.length;
const progress = (n: RunnerState): RunnerCommand[] =>
  n.value === "finished"
    ? [
        { type: "announce", step: "finished" },
        { type: "save", step: 0, completed: true },
      ]
    : [
        { type: "announce", step: n.index },
        { type: "save", step: n.index, completed: false },
      ];
const moves = (s: RunnerState, n: RunnerState) =>
  n.index !== s.index || (n.value === "finished") !== (s.value === "finished");

type Row = Transition<RunnerState, RunnerEvent, RunnerCommand>;
/** One row per state the facts can lead to: the first whose guard agrees with `position` wins. */
const goTo = (
  reduce: (s: RunnerState, e: RunnerEvent) => RunnerState,
  accept: (s: RunnerState, e: RunnerEvent) => boolean,
  announce: (s: RunnerState, n: RunnerState) => boolean,
): Row[] =>
  (["finished", "completing", "hinting", "active"] as const).map((target) => ({
    target,
    guard: (s, e) => accept(s, e) && reduce(s, e).value === target,
    reduce,
    effects: (s, _e, n) => (announce(s, n) ? progress(n) : []),
  }));

const observe = goTo(observed, fits, moves);
const latchCurrent = (s: RunnerState) =>
  position(s, { observed: s.observed, settled: s.settled, latched: s.latched.map((on, i) => on || i === s.index) });
/** Skip forgets the step's baseline: what it counts starts again from here, as when the step is entered. */
const unbase = (s: RunnerState): RunnerState => ({ ...s, baseline: {} });
const skip: Row[] = [
  // A step with a demo is done for you, then passes like any other.
  {
    target: "active",
    guard: (s) => s.demos[s.index] && s.value === "active",
    reduce: unbase,
    effects: (s) => [{ type: "demo", steps: [s.index] }],
  },
  {
    target: "hinting",
    guard: (s) => s.demos[s.index] && s.value === "hinting",
    reduce: unbase,
    effects: (s) => [{ type: "demo", steps: [s.index] }],
  },
  {
    target: "completing",
    guard: (s) => s.demos[s.index] && s.value === "completing",
    reduce: unbase,
    effects: (s) => [{ type: "demo", steps: [s.index] }],
  },
  // A moment (traffic seen) has nothing to do: it's latched.
  ...goTo(
    (s) => latchCurrent(unbase(s)),
    () => true,
    moves,
  ),
];
const restart: Row = {
  target: "active",
  // The sandbox goes back to its start: nothing is known to hold until the next observation says so.
  reduce: (s) => {
    const none = s.sticky.map(() => false);
    return { ...s, index: 0, observed: none, settled: none, latched: none, last: null, resumeAt: 0, baseline: {} };
  },
  effects: () => [{ type: "reset" }, { type: "announce", step: 0 }, { type: "save", step: 0, completed: false }],
};
const exit: Row = { target: "closed", reduce: unbase, effects: () => [{ type: "close" }] };
const highlights = (target: RunnerPhase): Row =>
  ({
    target,
    reduce: (s: RunnerState, e: RunnerEvent) => ({ ...s, highlights: e.type === "highlights" ? e.on : s.highlights }),
    effects: (_s: RunnerState, _e: RunnerEvent, n: RunnerState) => [{ type: "prefs", highlights: n.highlights }],
  }) as Row;
const stepRows = (state: "active" | "hinting" | "completing") => ({
  observe,
  skip: skip.map((row) => ({
    ...row,
    guard: (s: RunnerState, e: RunnerEvent) =>
      e.type === "skip" && e.stepId === s.stepIds[s.index] && (!row.guard || row.guard(s, e)),
  })),
  fix: skip.slice(0, 3),
  baseline: {
    target: state,
    guard: (s: RunnerState, e: RunnerEvent) => e.type === "baseline" && e.step === s.index,
    // The first reading of each wins: the step's start, not the latest tick.
    reduce: (s: RunnerState, e: RunnerEvent) =>
      e.type === "baseline" ? { ...s, baseline: { ...e.values, ...s.baseline } } : s,
  },
  restart,
  highlights: highlights(state),
  exit,
});

export const runnerMachine = defineMachine<RunnerState, RunnerEvent, RunnerCommand>({
  initial: runnerInitial([false, true], { highlights: true, resumeAt: 0 }),
  states: ["intro", "reconstructing", "active", "hinting", "completing", "finished", "closed"],
  events: [
    { type: "start" },
    { type: "resume" },
    { type: "reconstructed" },
    { type: "observe", met: [true, false], settled: [true, true] },
    { type: "observe", met: [true, false], settled: [false, true] },
    { type: "observe", met: [true, true], settled: [true, true] },
    { type: "observe", met: [false, false], settled: [true, true] },
    { type: "baseline", step: 0, values: { reading: [3, 1] } },
    { type: "baseline", step: 1, values: { reading: [5, 1] } },
    { type: "showMe" },
    { type: "skip", stepId: "0" },
    { type: "fix" },
    { type: "restart" },
    { type: "highlights", on: false },
    { type: "exit" },
  ],
  on: {
    intro: {
      // Observing in the intro keeps the facts current; the pointer moves once the learner starts.
      observe: {
        target: "intro",
        guard: fits,
        reduce: (s, e) =>
          e.type === "observe" ? { ...s, observed: e.met, settled: e.settled, latched: latchSeen(s, e.met) } : s,
      },
      start: goTo(
        (s) => position({ ...s, resumeAt: 0 }, s),
        () => true,
        () => true,
      ),
      // Continue: the earlier steps are done for you (the sandbox isn't kept between visits), then on from there.
      resume: {
        target: "reconstructing",
        guard: (s) => s.resumeAt > 0,
        reduce: (s) => ({
          ...s,
          latched: s.latched.map((on, i) => on || (s.sticky[i] && i < s.resumeAt)),
          index: s.resumeAt,
          baseline: {},
        }),
        effects: (s) => [
          { type: "reconstruct", steps: Array.from({ length: s.resumeAt }, (_, i) => i) },
          { type: "announce", step: s.resumeAt },
        ],
      },
      highlights: highlights("intro"),
      exit,
    },
    reconstructing: {
      // Keep observations current without persisting temporary replay positions.
      observe: {
        target: "reconstructing",
        guard: fits,
        reduce: (s, e) =>
          e.type === "observe" ? { ...s, observed: e.met, settled: e.settled, latched: latchSeen(s, e.met) } : s,
      },
      reconstructed: goTo(
        (s) => position(s, s),
        () => true,
        () => true,
      ),
      restart,
      highlights: highlights("reconstructing"),
      exit,
    },
    active: {
      ...stepRows("active"),
      showMe: { target: "hinting", effects: (s) => [{ type: "reveal", step: s.index }] },
    },
    hinting: stepRows("hinting"),
    completing: stepRows("completing"),
    finished: { restart, highlights: highlights("finished"), exit },
  },
});
