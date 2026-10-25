import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const retryStorm: Tutorial = {
  id: "retry-storm",
  version: 1,
  track: "resilience",
  level: 2,
  minutes: 4,
  title: msg("tutorials.retryStorm.title"),
  summary: msg("tutorials.retryStorm.summary"),
  start: { example: "retry-storm", simulation: "three-quick-retries" },
  subjects: {
    caller: { stencils: ["generic.service"] },
    callee: { stencils: ["generic.service"] },
  },
  steps: [
    {
      id: "run",
      title: msg("tutorials.retryStorm.runTitle"),
      goal: msg("tutorials.retryStorm.runGoal"),
      done: msg("tutorials.retryStorm.runDone"),
      check: { kind: "simulation", id: "three-quick-retries" },
      sticky: true,
      targets: [{ testId: "live-sim-picker", tip: msg("tutorials.retryStorm.runGoal") }],
      demo: [{ kind: "runSimulation", id: "three-quick-retries" }],
      solution: [{ select: "live-sim-picker", value: "three-quick-retries" }],
    },
    {
      id: "watch-waiting",
      title: msg("tutorials.retryStorm.waitTitle"),
      goal: msg("tutorials.retryStorm.waitGoal"),
      done: msg("tutorials.retryStorm.waitDone"),
      check: { kind: "readout", subject: "caller" },
      sticky: true,
      targets: [{ testId: "node-{caller}", tip: msg("tutorials.retryStorm.waitGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{caller}" }],
    },
    {
      id: "watch-failed",
      title: msg("tutorials.retryStorm.failedTitle"),
      goal: msg("tutorials.retryStorm.failedGoal"),
      done: msg("tutorials.retryStorm.failedDone"),
      check: { kind: "metric", subject: "callee", field: "failed", op: ">=", value: 1 },
      sticky: true,
      targets: [{ testId: "node-{callee}", tip: msg("tutorials.retryStorm.failedGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{callee}" }],
    },
    {
      id: "expect-backlog",
      title: msg("tutorials.retryStorm.expectTitle"),
      goal: msg("tutorials.retryStorm.expectGoal"),
      done: msg("tutorials.retryStorm.expectDone"),
      // eslint-disable-next-line local/no-literal-ui-text -- stable saved expectation id
      check: { kind: "expectation", simulation: "three-quick-retries", label: "backlog", outcome: "fail" },
      sticky: true,
      targets: [
        { testId: "live-expectations", tip: msg("tutorials.retryStorm.expectGoal"), dim: false },
        { testId: "live-expectations-summary", tip: msg("tutorials.retryStorm.expectGoal"), dim: false },
      ],
      demo: [],
      solution: [{ select: "live-speed", value: "8" }, { hover: "live-timeline" }],
    },
  ],
  finish: { text: msg("tutorials.retryStorm.finish") },
};
