import { diagnosticLesson } from "./diagnosticLesson";
import referenceText from "../../examples/retry-storm.json?raw";
import type { DiagramFile } from "../../model/types";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";

// Keep the public example’s independently retryable download out of the tutorial module graph.
const reference = JSON.parse(referenceText) as DiagramFile;

const lesson: Tutorial = {
  id: "backoff-budget",
  version: 2,
  track: "resilience",
  level: 2,
  minutes: 4,
  title: msg("tutorials.backoffBudget.title"),
  summary: msg("tutorials.backoffBudget.summaryV2"),
  start: { example: "retry-storm" },
  subjects: {
    caller: { stencils: ["generic.service"] },
    callee: { stencils: ["generic.service"] },
  },
  steps: [
    {
      id: "backoff",
      title: msg("tutorials.backoffBudget.backoffTitle"),
      goal: msg("tutorials.backoffBudget.backoffGoal"),
      done: msg("tutorials.backoffBudget.backoffDone"),
      check: { kind: "prop", edge: ["caller", "callee"], prop: ["caller", "retry", "backoffMs"], op: "=", value: 100 },
      targets: [
        { testId: "inspector-field-retry-backoff", tip: msg("tutorials.backoffBudget.backoffGoal") },
        { testId: "inspector-section-retry-details", tip: msg("tutorials.backoffBudget.backoffGoal") },
        { testId: "inspector-section-edge-simulation", tip: msg("tutorials.backoffBudget.backoffGoal") },
        { testId: "node-{callee}", tip: msg("tutorials.backoffBudget.backoffGoal") },
      ],
      demo: [
        {
          kind: "patch",
          edge: ["caller", "callee"],
          patches: [{ op: "set", path: ["caller", "retry", "backoffMs"], value: 100 }],
        },
      ],
      solution: [
        { click: "node-{callee}" },
        { press: "Control+Alt+[" },
        { open: "inspector-section-edge-simulation" },
        { open: "inspector-section-retry-details" },
        { fill: "inspector-field-retry-backoff", text: "100" },
        { press: "Enter" },
      ],
    },
    {
      id: "budget",
      title: msg("tutorials.backoffBudget.budgetTitle"),
      goal: msg("tutorials.backoffBudget.budgetGoal"),
      done: msg("tutorials.backoffBudget.budgetDone"),
      check: {
        kind: "prop",
        edge: ["caller", "callee"],
        prop: ["caller", "retry", "budget", "percent"],
        op: "=",
        value: 20,
      },
      targets: [
        { testId: "inspector-field-retry-budget", tip: msg("tutorials.backoffBudget.budgetGoal") },
        { testId: "inspector-section-retry-budget-details", tip: msg("tutorials.backoffBudget.budgetGoal") },
        { testId: "node-{callee}", tip: msg("tutorials.backoffBudget.budgetGoal") },
      ],
      demo: [
        {
          kind: "patch",
          edge: ["caller", "callee"],
          patches: [
            { op: "set", path: ["caller", "retry", "budget", "percent"], value: 20 },
            { op: "setIfMissing", path: ["caller", "retry", "budget", "minPerSec"], value: 10 },
          ],
        },
      ],
      solution: [{ open: "inspector-section-retry-budget-details" }, { click: "inspector-field-retry-budget" }],
    },
    {
      id: "run-jitter",
      title: msg("tutorials.backoffBudget.jitterTitle"),
      goal: msg("tutorials.backoffBudget.jitterGoalV2"),
      done: msg("tutorials.backoffBudget.jitterDone"),
      check: { kind: "simulation", id: "jittered-backoff" },
      sticky: true,
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.backoffBudget.jitterGoalV2") },
        { testId: "live-toggle", tip: msg("tutorials.backoffBudget.jitterGoalV2") },
      ],
      demo: [{ kind: "runSimulation", id: "jittered-backoff" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "jittered-backoff" }],
    },
    {
      id: "expect-jitter-backlog",
      title: msg("tutorials.backoffBudget.jitterExpectTitle"),
      goal: msg("tutorials.backoffBudget.jitterExpectGoalV2"),
      done: msg("tutorials.backoffBudget.jitterExpectDone"),
      // eslint-disable-next-line local/no-literal-ui-text -- stable saved expectation id
      check: { kind: "expectation", simulation: "jittered-backoff", label: "backlog", outcome: "fail" },
      sticky: true,
      targets: [
        { testId: "live-expectations", tip: msg("tutorials.backoffBudget.jitterExpectGoalV2"), dim: false },
        { testId: "live-expectations-summary", tip: msg("tutorials.backoffBudget.jitterExpectGoalV2"), dim: false },
      ],
      demo: [],
      solution: [
        { select: "live-speed", value: "8" },
        { open: "live-expectations-summary" },
        { hover: "live-timeline" },
      ],
    },
    {
      id: "read-failed-expectation",
      title: msg("tutorials.backoffBudget.jitterExpectTitle"),
      goal: msg("tutorials.backoffBudget.jitterExpectGoalV2"),
      done: msg("tutorials.backoffBudget.jitterExpectDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "live-expectations-summary", tip: msg("tutorials.backoffBudget.jitterExpectTitle") }],
      demo: [],
      solution: [{ open: "live-expectations-summary" }, { click: "tutorial-skip" }],
    },
    {
      id: "run-budget",
      title: msg("tutorials.backoffBudget.runBudgetTitle"),
      goal: msg("tutorials.backoffBudget.runBudgetGoal"),
      done: msg("tutorials.backoffBudget.runBudgetDone"),
      check: { kind: "simulation", id: "retry-budget" },
      sticky: true,
      targets: [{ testId: "live-sim-picker", tip: msg("tutorials.backoffBudget.runBudgetGoal") }],
      demo: [{ kind: "runSimulation", id: "retry-budget" }],
      solution: [{ select: "live-sim-picker", value: "retry-budget" }],
    },
    {
      id: "compare",
      title: msg("tutorials.backoffBudget.compareTitle"),
      goal: msg("tutorials.backoffBudget.compareGoalV2"),
      done: msg("tutorials.backoffBudget.compareDone"),
      check: {
        kind: "all",
        checks: [
          // eslint-disable-next-line local/no-literal-ui-text -- stable saved expectation ids
          { kind: "expectation", simulation: "retry-budget", label: "backlog" },
          // eslint-disable-next-line local/no-literal-ui-text -- stable saved expectation ids
          { kind: "expectation", simulation: "retry-budget", label: "goodput" },
        ],
      },
      sticky: true,
      targets: [
        { testId: "live-expectations", tip: msg("tutorials.backoffBudget.compareGoalV2"), dim: false },
        { testId: "live-expectations-summary", tip: msg("tutorials.backoffBudget.compareGoalV2"), dim: false },
      ],
      demo: [],
      solution: [{ select: "live-speed", value: "8" }, { hover: "live-timeline" }],
    },
  ],
  finish: { text: msg("tutorials.backoffBudget.finishV2") },
};

export const backoffBudget = diagnosticLesson(lesson, () => structuredClone(reference) as DiagramFile);
