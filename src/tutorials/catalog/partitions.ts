import { livePropertiesGoal } from "./liveProperties";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const partitions: Tutorial = {
  id: "partitions",
  version: 3,
  track: "blocks",
  level: 2,
  minutes: 3,
  title: msg("tutorials.partitions.title"),
  summary: msg("tutorials.partitions.summaryVerified"),
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
      goal: livePropertiesGoal(msg("tutorials.partitions.editGoal")),
      done: msg("tutorials.partitions.editDone"),
      check: { kind: "prop", subject: "topic", prop: "partitions", op: "=", value: 6 },
      targets: [
        {
          testId: "dock-edit-properties",
          tip: livePropertiesGoal(msg("tutorials.partitions.editGoal")),
          selected: "topic",
        },
        { testId: "inspector-field-partitions", tip: msg("tutorials.partitions.editGoal") },
        { testId: "inspector-section-node-simulation", tip: msg("tutorials.partitions.editGoal") },
        { testId: "node-{topic}", tip: msg("tutorials.partitions.editGoal") },
      ],
      demo: [{ kind: "prop", subject: "topic", props: { partitions: 6 } }],
      solution: [
        { dblclick: "node-{topic}" },
        { open: "dock-edit-properties" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-partitions", text: "6" },
        { press: "Enter" },
      ],
    },
    {
      id: "rerun",
      title: msg("tutorials.partitions.rerunTitle"),
      goal: msg("tutorials.partitions.rerunGoalVerified"),
      done: msg("tutorials.partitions.rerunDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "more-partitions", atLeastMs: 1000 },
          { kind: "prop", subject: "topic", prop: "partitions", op: "=", value: 8, effective: true },
          { kind: "processed", subject: "consumers", atLeast: 5 },
        ],
      },
      targets: [{ testId: "live-sim-picker", tip: msg("tutorials.partitions.rerunGoalVerified") }],
      demo: [{ kind: "runSimulation", id: "more-partitions" }],
      solution: [{ select: "live-sim-picker", value: "more-partitions" }],
    },
  ],
  finish: { text: msg("tutorials.partitions.finishVerified") },
};
