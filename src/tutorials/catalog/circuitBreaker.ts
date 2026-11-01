import { breakerPractice } from "../../lab/waitingPractice";
import { diagnosticLesson } from "./diagnosticLesson";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";

const lesson: Tutorial = {
  id: "circuit-breaker",
  version: 2,
  track: "resilience",
  level: 2,
  minutes: 4,
  title: msg("tutorials.circuitBreaker.title"),
  summary: msg("tutorials.circuitBreaker.summaryV2"),
  start: breakerPractice,
  subjects: {
    caller: { stencils: ["generic.service"] },
    callee: { stencils: ["generic.service"] },
  },
  steps: [
    {
      id: "enable",
      title: msg("tutorials.circuitBreaker.enableTitle"),
      goal: msg("tutorials.circuitBreaker.enableGoal"),
      done: msg("tutorials.circuitBreaker.enableDone"),
      check: { kind: "prop", edge: ["caller", "callee"], prop: ["caller", "breaker"], op: "truthy" },
      targets: [
        { testId: "inspector-field-breaker-on", tip: msg("tutorials.circuitBreaker.enableGoal") },
        { testId: "inspector-section-edge-simulation", tip: msg("tutorials.circuitBreaker.enableGoal") },
        { testId: "node-{callee}", tip: msg("tutorials.circuitBreaker.enableGoal") },
      ],
      demo: [
        { kind: "patch", edge: ["caller", "callee"], patches: [{ op: "set", path: ["caller", "breaker"], value: {} }] },
      ],
      solution: [
        { click: "node-{callee}" },
        { press: "Control+Alt+[" },
        { click: "inspector-section-edge-simulation" },
        { click: "inspector-field-breaker-on" },
      ],
    },
    {
      id: "run",
      title: msg("tutorials.circuitBreaker.runTitle"),
      goal: msg("tutorials.circuitBreaker.runGoal"),
      done: msg("tutorials.circuitBreaker.runDone"),
      check: { kind: "simulation", id: "circuit-breaker" },
      sticky: true,
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.circuitBreaker.runGoal") },
        { testId: "live-toggle", tip: msg("tutorials.circuitBreaker.runGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "circuit-breaker" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "circuit-breaker" }],
    },
    {
      id: "open",
      title: msg("tutorials.circuitBreaker.openTitle"),
      goal: msg("tutorials.circuitBreaker.openGoalV2"),
      done: msg("tutorials.circuitBreaker.openDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "circuit-breaker", atLeastMs: 9000 },
          { kind: "note", waiting: true },
          { kind: "metric", subject: "caller", edge: ["caller", "callee"], field: "breaker", op: "=", value: "open" },
        ],
      },
      sticky: true,
      targets: [{ testId: "edge-{caller->callee}", tip: msg("tutorials.circuitBreaker.openGoalV2"), dim: false }],
      demo: [],
      solution: [{ hover: "edge-{caller->callee}" }],
    },
    {
      id: "continue-open",
      title: msg("tutorials.circuitBreaker.testingTitle"),
      goal: msg("tutorials.circuitBreaker.continueTipV2"),
      done: msg("tutorials.circuitBreaker.openDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "circuit-breaker", atLeastMs: 9000 },
          { kind: "note", waiting: false, currentOnly: true },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.circuitBreaker.continueTipV2") }],
      demo: [{ kind: "continueNote", simulation: "circuit-breaker", atLeastMs: 9000 }],
      solution: [{ click: "live-note-continue" }],
    },
    {
      id: "testing",
      title: msg("tutorials.circuitBreaker.testingTitle"),
      goal: msg("tutorials.circuitBreaker.testingGoalV2"),
      done: msg("tutorials.circuitBreaker.testingDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "circuit-breaker", atLeastMs: 10500 },
          { kind: "note", waiting: true },
          {
            kind: "metric",
            subject: "caller",
            edge: ["caller", "callee"],
            field: "breaker",
            op: "=",
            value: "half-open",
          },
        ],
      },
      sticky: true,
      targets: [{ testId: "edge-{caller->callee}", tip: msg("tutorials.circuitBreaker.testingGoalV2"), dim: false }],
      demo: [],
      solution: [{ hover: "edge-{caller->callee}" }],
    },
    {
      id: "closed",
      title: msg("tutorials.circuitBreaker.closedTitle"),
      goal: msg("tutorials.circuitBreaker.closedGoalV2"),
      done: msg("tutorials.circuitBreaker.closedDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "circuit-breaker", atLeastMs: 15000 },
          { kind: "note", waiting: false },
          { kind: "metric", subject: "caller", edge: ["caller", "callee"], field: "breaker", op: "=", value: "closed" },
        ],
      },
      sticky: true,
      targets: [
        { testId: "live-note-continue", tip: msg("tutorials.circuitBreaker.continueTipV2") },
        { testId: "edge-{caller->callee}", tip: msg("tutorials.circuitBreaker.closedGoalV2"), dim: false },
      ],
      demo: [{ kind: "continueNote", simulation: "circuit-breaker", atLeastMs: 10500 }],
      solution: [
        { click: "live-note-continue" },
        { select: "live-speed", value: "8" },
        { hover: "edge-{caller->callee}" },
      ],
    },
    {
      id: "recovered",
      title: msg("tutorials.circuitBreaker.recoveredTitleV2"),
      goal: msg("tutorials.circuitBreaker.recoveredGoalV2"),
      done: msg("tutorials.circuitBreaker.recoveredDoneV2"),
      check: {
        kind: "expectation",
        simulation: "circuit-breaker",
        match: { metric: { node: "shop", field: "goodput" }, op: ">=", value: 270, when: "end" },
      },
      sticky: true,
      targets: [{ testId: "live-expectations-summary", tip: msg("tutorials.circuitBreaker.recoveredGoalV2") }],
      demo: [],
      solution: [{ select: "live-speed", value: "8" }],
    },
  ],
  finish: { text: msg("tutorials.circuitBreaker.finishV2") },
};

export const circuitBreaker = diagnosticLesson(lesson, breakerPractice);
