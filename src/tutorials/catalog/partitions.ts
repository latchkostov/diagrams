import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const partitions: Tutorial = {
  id: "partitions",
  version: 2,
  track: "blocks",
  level: 2,
  minutes: 3,
  title: msg("tutorials.partitions.title"),
  summary: msg("tutorials.partitions.summary"),
  start: { example: "partitions-vs-subscriptions", simulation: "compare" },
  subjects: { topic: { stencils: ["kafka.topic"] }, consumers: { stencils: ["service.java"] } },
  steps: [
    {
      id: "read-idle",
      title: msg("tutorials.partitions.idleTitle"),
      goal: msg("tutorials.partitions.idleGoal"),
      done: msg("tutorials.partitions.idleDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{consumers}", tip: msg("tutorials.partitions.idleGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{consumers}" }, { click: "tutorial-skip" }],
    },
    {
      id: "six-partitions",
      title: msg("tutorials.partitions.editTitle"),
      goal: msg("tutorials.partitions.editGoal"),
      done: msg("tutorials.partitions.editDone"),
      check: { kind: "prop", subject: "topic", prop: "partitions", op: "=", value: 6 },
      targets: [
        { testId: "inspector-field-partitions", tip: msg("tutorials.partitions.editGoal") },
        { testId: "inspector-section-node-simulation", tip: msg("tutorials.partitions.editGoal") },
        { testId: "node-{topic}", tip: msg("tutorials.partitions.editGoal") },
      ],
      demo: [{ kind: "prop", subject: "topic", props: { partitions: 6 } }],
      solution: [
        { dblclick: "node-{topic}" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-partitions", text: "6" },
        { press: "Enter" },
      ],
    },
    {
      id: "rerun",
      title: msg("tutorials.partitions.rerunTitle"),
      goal: msg("tutorials.partitions.rerunGoal"),
      done: msg("tutorials.partitions.rerunDone"),
      check: { kind: "simulation", id: "more-partitions", atLeastMs: 1000 },
      targets: [{ testId: "live-sim-picker", tip: msg("tutorials.partitions.rerunGoal") }],
      demo: [{ kind: "runSimulation", id: "more-partitions" }],
      solution: [{ select: "live-sim-picker", value: "more-partitions" }],
    },
  ],
  finish: { text: msg("tutorials.partitions.finish") },
};
