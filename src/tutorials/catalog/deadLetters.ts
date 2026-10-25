import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const deadLetters: Tutorial = {
  id: "dead-letters",
  version: 2,
  track: "resilience",
  level: 2,
  minutes: 4,
  title: msg("tutorials.deadLetters.title"),
  summary: msg("tutorials.deadLetters.summary"),
  start: { example: "azure-service-bus-integration" },
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
      id: "max-deliveries",
      title: msg("tutorials.deadLetters.maxTitle"),
      goal: msg("tutorials.deadLetters.maxGoal"),
      done: msg("tutorials.deadLetters.maxDone"),
      check: { kind: "prop", subject: "commands", prop: "maxDeliveryCount", op: "=", value: 3 },
      targets: [
        { testId: "inspector-field-maxDeliveryCount", tip: msg("tutorials.deadLetters.maxGoal"), selected: "commands" },
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
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-maxDeliveryCount", text: "3" },
        { press: "Tab" },
      ],
    },
    {
      id: "replay",
      title: msg("tutorials.deadLetters.replayTitle"),
      goal: msg("tutorials.deadLetters.replayGoal"),
      done: msg("tutorials.deadLetters.replayDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{commands}", tip: msg("tutorials.deadLetters.replayGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{commands}" }, { click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.deadLetters.finish") },
};
