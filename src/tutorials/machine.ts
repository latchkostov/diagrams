import { defineMachine, type Transition } from "../lib/machine";

/**
 * The step runner (docs/QUALITY.md, "Lifecycles with modes"). Pure: the runner (./runner.ts) sends it what the
 * sandbox shows (`observe`, each step's check) and what the learner presses, and executes the commands it returns.
 *
 * The current step is always the first step not held. A step is held while its check holds, or for good once a
 * sticky step's check has held (or it was skipped). So Undo goes back a step by itself, a step already done (the
 * "+" also connects) is passed over, and leaving Live while watching traffic goes back to "Go live".
 */
export type RunnerPhase = "intro" | "step" | "finished" | "closed";
export interface RunnerState {
  value: RunnerPhase;
  /** The current step (intro: where Start begins). */
  index: number;
  /** Each step's check, as last observed. */
  observed: readonly boolean[];
  /** Sticky steps whose check held once, or that were skipped. */
  latched: readonly boolean[];
  /** From the definition: which steps latch. */
  sticky: readonly boolean[];
  /** The step done most recently, for its "done" words. */
  last: number | null;
  /** "Show me" pressed on the current step: its hint shows and its target is highlighted even with highlights off. */
  shown: boolean;
  highlights: boolean;
  /** Saved progress: the step this tutorial was left at, or 0. */
  resumeAt: number;
}
export type RunnerEvent =
  | { type: "start" | "resume" | "showMe" | "skip" | "restart" | "exit" }
  | { type: "observe"; met: readonly boolean[] }
  | { type: "highlights"; on: boolean };
export type RunnerCommand =
  /** Do these steps for the learner, in order, each once its predecessors' changes have landed. */
  | { type: "demo"; steps: readonly number[] }
  /** Put the starting diagram back and leave Live. */
  | { type: "reset" }
  /** Bring the current step's target into view. */
  | { type: "reveal"; step: number }
  | { type: "announce"; step: number | "finished" }
  | { type: "save"; step: number; completed: boolean }
  | { type: "prefs"; highlights: boolean }
  | { type: "close" };

export function runnerInitial(
  sticky: readonly boolean[],
  opts: { highlights: boolean; resumeAt: number },
): RunnerState {
  return {
    value: "intro",
    index: 0,
    observed: sticky.map(() => false),
    latched: sticky.map(() => false),
    sticky,
    last: null,
    shown: false,
    highlights: opts.highlights,
    resumeAt: Math.max(0, Math.min(opts.resumeAt, sticky.length - 1)),
  };
}

const held = (s: Pick<RunnerState, "observed" | "latched">, i: number) => s.observed[i] || s.latched[i];
/** The first step not held, or the step count when all are. */
export const firstOpen = (s: Pick<RunnerState, "observed" | "latched">): number => {
  const i = s.observed.findIndex((_, n) => !held(s, n));
  return i < 0 ? s.observed.length : i;
};
const latch = (s: RunnerState, observed: readonly boolean[]) =>
  s.latched.map((on, i) => on || (s.sticky[i] && observed[i]));
/** Where the step pointer goes, keeping `last` and "Show me" right as it moves. */
function settle(s: RunnerState, observed: readonly boolean[], latched: readonly boolean[]): RunnerState {
  const index = firstOpen({ observed, latched });
  const moved = index !== s.index;
  return {
    ...s,
    observed,
    latched,
    index,
    shown: moved ? false : s.shown,
    last: index > s.index ? index - 1 : moved ? null : s.last,
  };
}
const moves = (s: RunnerState, n: RunnerState) => n.index !== s.index || n.value !== s.value;
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

type Row = Transition<RunnerState, RunnerEvent, RunnerCommand>;
const done = (s: RunnerState, e: RunnerEvent) => {
  if (e.type !== "observe") return false;
  return firstOpen({ observed: e.met, latched: latch(s, e.met) }) === s.observed.length;
};
const observe: Row[] = [
  {
    target: "finished",
    guard: done,
    reduce: (s, e) => {
      const met = (e as Extract<RunnerEvent, { type: "observe" }>).met;
      return { ...settle(s, met, latch(s, met)), index: s.observed.length - 1, last: s.observed.length - 1 };
    },
    effects: (_s, _e, n) => progress(n),
  },
  {
    target: "step",
    guard: (s, e) => e.type === "observe" && e.met.length === s.observed.length,
    reduce: (s, e) => {
      const met = (e as Extract<RunnerEvent, { type: "observe" }>).met;
      return settle(s, met, latch(s, met));
    },
    effects: (s, _e, n) => (moves(s, n) ? progress(n) : []),
  },
];
const restart: Row = {
  target: "step",
  // The sandbox goes back to its start: nothing is known to hold until the next observation says so.
  reduce: (s) => ({
    ...s,
    index: 0,
    observed: s.sticky.map(() => false),
    latched: s.sticky.map(() => false),
    last: null,
    shown: false,
    resumeAt: 0,
  }),
  effects: () => [{ type: "reset" }, { type: "announce", step: 0 }, { type: "save", step: 0, completed: false }],
};
const exit: Row = { target: "closed", effects: () => [{ type: "close" }] };
const highlights: Row = {
  target: "step",
  reduce: (s, e) => ({ ...s, highlights: e.type === "highlights" ? e.on : s.highlights }),
  effects: (_s, _e, n) => [{ type: "prefs", highlights: n.highlights }],
};

export const runnerMachine = defineMachine<RunnerState, RunnerEvent, RunnerCommand>({
  initial: runnerInitial([false, true], { highlights: true, resumeAt: 0 }),
  states: ["intro", "step", "finished", "closed"],
  events: [
    { type: "start" },
    { type: "resume" },
    { type: "observe", met: [true, false] },
    { type: "observe", met: [true, true] },
    { type: "observe", met: [false, false] },
    { type: "showMe" },
    { type: "skip" },
    { type: "restart" },
    { type: "highlights", on: false },
    { type: "exit" },
  ],
  on: {
    intro: {
      // Observing in the intro keeps the checks current; the pointer moves once the learner starts.
      observe: {
        target: "intro",
        guard: (s, e) => e.type === "observe" && e.met.length === s.observed.length,
        reduce: (s, e) => ({ ...s, observed: e.type === "observe" ? e.met : s.observed }),
      },
      // Everything may already hold (a learner who built ahead of the intro): then it's done.
      start: [
        {
          target: "finished",
          guard: (s) => firstOpen(s) === s.observed.length,
          reduce: (s) => ({ ...s, resumeAt: 0, index: s.observed.length - 1, last: s.observed.length - 1 }),
          effects: (_s, _e, n) => progress(n),
        },
        {
          target: "step",
          reduce: (s) => settle({ ...s, resumeAt: 0 }, s.observed, s.latched),
          effects: (_s, _e, n) => progress(n),
        },
      ],
      // Continue: the earlier steps are done for you (the sandbox isn't kept between visits), then on from there.
      resume: {
        target: "step",
        guard: (s) => s.resumeAt > 0,
        reduce: (s) => ({
          ...s,
          latched: s.latched.map((on, i) => on || (s.sticky[i] && i < s.resumeAt)),
          index: s.resumeAt,
        }),
        effects: (s) => [
          { type: "demo", steps: Array.from({ length: s.resumeAt }, (_, i) => i) },
          { type: "announce", step: s.resumeAt },
        ],
      },
      highlights: { ...highlights, target: "intro" },
      exit,
    },
    step: {
      observe,
      showMe: {
        target: "step",
        guard: (s) => !s.shown,
        reduce: (s) => ({ ...s, shown: true }),
        effects: (s) => [{ type: "reveal", step: s.index }],
      },
      // A step with a demo is done for you and then passes like any other; one without (a moment, like traffic
      // seen) is latched.
      skip: [
        {
          target: "step",
          guard: (s) => !s.sticky[s.index],
          effects: (s) => [{ type: "demo", steps: [s.index] }],
        },
        {
          target: "step",
          guard: (s) =>
            firstOpen({ observed: s.observed, latched: s.latched.map((on, i) => on || i === s.index) }) <
            s.observed.length,
          reduce: (s) =>
            settle(
              s,
              s.observed,
              s.latched.map((on, i) => on || i === s.index),
            ),
          effects: (s, _e, n) => (moves(s, n) ? progress(n) : []),
        },
        {
          target: "finished",
          reduce: (s) => ({ ...s, latched: s.latched.map((on, i) => on || i === s.index), last: s.index }),
          effects: (_s, _e, n) => progress(n),
        },
      ],
      restart,
      highlights,
      exit,
    },
    finished: { restart, highlights: { ...highlights, target: "finished" }, exit },
  },
});
