import { msg } from "../../i18n";
import type { Tutorial } from "../types";

// owner decision pending: retry narration pause
export const savedSimulations: Tutorial = {
  id: "saved-simulations",
  version: 1,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.savedSimulations.title"),
  summary: msg("tutorials.savedSimulations.summary"),
  start: { example: "retry-storm", simulation: "three-quick-retries" },
  subjects: { checkout: { stencils: ["generic.service"] } },
  steps: [
    {
      id: "live",
      title: msg("tutorials.savedSimulations.liveTitle"),
      goal: msg("tutorials.savedSimulations.liveGoal"),
      done: msg("tutorials.savedSimulations.liveDone"),
      check: { kind: "simulation", id: "three-quick-retries" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.savedSimulations.liveGoal") },
        { testId: "live-toggle", tip: msg("tutorials.savedSimulations.liveGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "three-quick-retries" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "three-quick-retries" }],
    },
    {
      id: "waiting",
      title: msg("tutorials.savedSimulations.waitingTitle"),
      goal: msg("tutorials.savedSimulations.waitingGoal"),
      done: msg("tutorials.savedSimulations.waitingDone"),
      check: { kind: "note", waiting: true },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.savedSimulations.waitingGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "live-note-continue" }],
    },
    {
      id: "continue",
      title: msg("tutorials.savedSimulations.continueTitle"),
      goal: msg("tutorials.savedSimulations.continueGoal"),
      done: msg("tutorials.savedSimulations.continueDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "three-quick-retries", atLeastMs: 1200 },
          { kind: "note", waiting: false },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.savedSimulations.continueGoal"), dim: false }],
      demo: [{ kind: "continueNote", simulation: "three-quick-retries", atLeastMs: 1200 }],
      solution: [{ click: "live-note-continue" }],
    },
    {
      id: "expectation",
      title: msg("tutorials.savedSimulations.expectationTitle"),
      goal: msg("tutorials.savedSimulations.expectationGoal"),
      done: msg("tutorials.savedSimulations.expectationDone"),
      // eslint-disable-next-line local/no-literal-ui-text -- Stable saved expectation id, never displayed copy.
      check: { kind: "expectation", simulation: "three-quick-retries", label: "goodput", outcome: "either" },
      sticky: true,
      targets: [{ testId: "live-speed", tip: msg("tutorials.savedSimulations.expectationGoal"), dim: false }],
      demo: [],
      solution: [{ select: "live-speed", value: "8" }],
    },
  ],
  finish: { text: msg("tutorials.savedSimulations.finish") },
  quarantined: true,
};
