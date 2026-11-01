import { deadLetterPractice } from "../../lab/waitingPractice";
import { diagnosticLesson } from "./diagnosticLesson";
import { livePropertiesGoal } from "./liveProperties";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";

const lesson: Tutorial = {
  id: "dead-letters",
  version: 3,
  track: "resilience",
  level: 2,
  minutes: 4,
  title: msg("tutorials.deadLetters.title"),
  summary: msg("tutorials.deadLetters.summaryV3"),
  start: deadLetterPractice,
  // The command queue is the first Service Bus queue, before its DLQ and the subscription DLQs.
  subjects: { commands: { stencils: ["azure.service-bus.queue"] } },
  steps: [
    {
      id: "run-poison",
      title: msg("tutorials.deadLetters.runTitle"),
      goal: msg("tutorials.deadLetters.runGoal"),
      done: msg("tutorials.deadLetters.runDone"),
      check: { kind: "simulation", id: "poison" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.deadLetters.runGoal") },
        { testId: "live-toggle", tip: msg("tutorials.deadLetters.runGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "poison" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "poison" }],
    },
    {
      id: "watch-dead-letter",
      title: msg("tutorials.deadLetters.watchTitle"),
      goal: msg("tutorials.deadLetters.watchGoal"),
      done: msg("tutorials.deadLetters.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "poison" },
          { kind: "compare", left: { node: "commands", metric: "deadLettered" }, op: ">=", right: 1 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{commands}", tip: msg("tutorials.deadLetters.watchGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{commands}" }],
    },
    {
      id: "investigate",
      title: msg("tutorials.deadLetters.investigateTitleV3"),
      goal: msg("tutorials.deadLetters.investigateGoalV3"),
      done: msg("tutorials.deadLetters.investigateDoneV3"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "poison" },
          { kind: "trace", deadLetter: { subject: "commands" } },
        ],
      },
      sticky: true,
      targets: [
        { testId: "live-trace-deadletter", tip: msg("tutorials.deadLetters.investigateTitleV3") },
        { testId: "live-trace-message", tip: msg("tutorials.deadLetters.investigateTitleV3") },
        { testId: "trace-card", tip: msg("tutorials.deadLetters.investigateGoalV3") },
        { testId: "live-more", tip: msg("tutorials.deadLetters.investigateTitleV3") },
      ],
      demo: [{ kind: "trace", deadLetter: true }],
      reconstruct: [{ kind: "trace", deadLetter: true }],
      solution: [{ click: "live-more" }, { click: "live-trace-message" }, { click: "live-trace-deadletter" }],
    },
    {
      id: "max-deliveries",
      title: msg("tutorials.deadLetters.maxTitle"),
      goal: livePropertiesGoal(msg("tutorials.deadLetters.maxGoal")),
      done: msg("tutorials.deadLetters.maxDoneV3"),
      check: { kind: "prop", subject: "commands", prop: "maxDeliveryCount", op: "=", value: 3 },
      targets: [
        { testId: "inspector-field-maxDeliveryCount", tip: msg("tutorials.deadLetters.maxGoal"), selected: "commands" },
        { testId: "dock-edit-properties", tip: msg("tutorials.deadLetters.maxGoal"), selected: "commands" },
        {
          testId: "inspector-section-node-simulation",
          tip: msg("tutorials.deadLetters.maxGoal"),
          selected: "commands",
        },
        { testId: "node-{commands}", tip: msg("tutorials.deadLetters.maxGoal") },
      ],
      demo: [{ kind: "patch", subject: "commands", patches: [{ op: "set", path: ["maxDeliveryCount"], value: 3 }] }],
      solution: [
        { dblclick: "node-{commands}" },
        { open: "dock-edit-properties" },
        { open: "inspector-section-node-simulation" },
        { fill: "inspector-field-maxDeliveryCount", text: "3" },
        { press: "Tab" },
      ],
    },
    {
      id: "rerun-limit",
      title: msg("tutorials.deadLetters.rerunTitleV3"),
      goal: msg("tutorials.deadLetters.rerunGoalV3"),
      done: msg("tutorials.deadLetters.rerunDoneV3"),
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "simulation", id: "poison" },
          { kind: "prop", subject: "commands", prop: "maxDeliveryCount", effective: true, op: "=", value: 3 },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-restart", tip: msg("tutorials.deadLetters.rerunGoalV3") }],
      demo: [{ kind: "runSimulation", id: "poison" }],
      solution: [{ click: "live-restart" }],
    },
    {
      id: "verify-limit",
      title: msg("tutorials.deadLetters.verifyTitleV3"),
      goal: msg("tutorials.deadLetters.verifyGoalV3"),
      done: msg("tutorials.deadLetters.verifyDoneV3"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "poison" },
          { kind: "prop", subject: "commands", prop: "maxDeliveryCount", effective: true, op: "=", value: 3 },
          { kind: "trace", deadLetter: { subject: "commands", attempt: 3 } },
        ],
      },
      sticky: true,
      targets: [
        { testId: "live-trace-deadletter", tip: msg("tutorials.deadLetters.investigateTitleV3") },
        { testId: "live-trace-message", tip: msg("tutorials.deadLetters.investigateTitleV3") },
        { testId: "trace-card", tip: msg("tutorials.deadLetters.verifyGoalV3") },
        { testId: "live-more", tip: msg("tutorials.deadLetters.verifyTitleV3") },
      ],
      demo: [{ kind: "trace", deadLetter: true }],
      solution: [{ click: "live-more" }, { click: "live-trace-message" }, { click: "live-trace-deadletter" }],
    },
    {
      id: "replay",
      title: msg("tutorials.deadLetters.replayTitle"),
      goal: msg("tutorials.deadLetters.replayGoalV3"),
      done: msg("tutorials.deadLetters.replayDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{commands}", tip: msg("tutorials.deadLetters.replayGoalV3"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{commands}" }, { click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.deadLetters.finishV3") },
};

export const deadLetters = diagnosticLesson(lesson, deadLetterPractice);
