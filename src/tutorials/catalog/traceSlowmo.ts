import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const traceSlowmo: Tutorial = {
  id: "trace-slowmo",
  version: 1,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.traceSlowmo.title"),
  summary: msg("tutorials.traceSlowmo.summary"),
  start: { example: "kafka-order-pipeline" },
  subjects: { client: { stencils: ["client.browser"] } },
  steps: [
    {
      id: "live",
      title: msg("tutorials.traceSlowmo.liveTitle"),
      goal: msg("tutorials.traceSlowmo.liveGoal"),
      done: msg("tutorials.traceSlowmo.liveDone"),
      check: { kind: "simulation", id: "black-friday" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.traceSlowmo.liveGoal") },
        { testId: "live-toggle", tip: msg("tutorials.traceSlowmo.liveGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "black-friday" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "black-friday" }],
    },
    {
      id: "slowmo",
      title: msg("tutorials.traceSlowmo.slowmoTitle"),
      goal: msg("tutorials.traceSlowmo.slowmoGoal"),
      done: msg("tutorials.traceSlowmo.slowmoDone"),
      check: { kind: "slowmo" },
      sticky: true,
      targets: [
        { testId: "context-menu-item-sim.slowmo-from", tip: msg("tutorials.traceSlowmo.slowmoGoal"), dim: false },
        { testId: "node-{client}", tip: msg("tutorials.traceSlowmo.slowmoGoal"), dim: false },
      ],
      demo: [{ kind: "slowmo", subject: "client" }],
      solution: [{ rightclick: "node-{client}" }, { click: "context-menu-item-sim.slowmo-from" }],
    },
    {
      id: "finished",
      title: msg("tutorials.traceSlowmo.finishedTitle"),
      goal: msg("tutorials.traceSlowmo.finishedGoal"),
      done: msg("tutorials.traceSlowmo.finishedDone"),
      check: { kind: "slowmo", finished: true },
      sticky: true,
      targets: [{ testId: "node-{client}", tip: msg("tutorials.traceSlowmo.finishedGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{client}" }],
    },
  ],
  finish: { text: msg("tutorials.traceSlowmo.finish") },
};
