import { msg } from "../../i18n";
import type { Tutorial } from "../types";

// owner decision pending: Bottleneck callout "open" step
export const capacity: Tutorial = {
  id: "capacity",
  version: 1,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.capacity.title"),
  summary: msg("tutorials.capacity.summary"),
  chrome: "app",
  start: { example: "measured-order-capacity", simulation: "triple" },
  subjects: { worker: { stencils: ["service.java"] }, queue: { stencils: ["generic.queue"] } },
  steps: [
    {
      id: "live",
      title: msg("tutorials.capacity.liveTitle"),
      goal: msg("tutorials.capacity.liveGoal"),
      done: msg("tutorials.capacity.liveDone"),
      check: { kind: "simulation", id: "triple" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.capacity.liveGoal") },
        { testId: "live-toggle", tip: msg("tutorials.capacity.liveGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "triple" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "triple" }],
    },
    {
      id: "overlay",
      title: msg("tutorials.capacity.overlayTitle"),
      goal: msg("tutorials.capacity.overlayGoal"),
      done: msg("tutorials.capacity.overlayDone"),
      check: { kind: "liveView", view: "capacity", open: true },
      targets: [
        { testId: "capacity-overlay-toggle", tip: msg("tutorials.capacity.overlayGoal") },
        { testId: "view-button", tip: msg("tutorials.capacity.overlayGoal") },
      ],
      demo: [{ kind: "openView", view: "capacity" }],
      solution: [{ click: "view-button" }, { click: "capacity-overlay-toggle" }],
    },
    {
      id: "backlog",
      title: msg("tutorials.capacity.backlogTitle"),
      goal: msg("tutorials.capacity.backlogGoal"),
      done: msg("tutorials.capacity.backlogDone"),
      check: { kind: "metric", subject: "queue", field: "backlog", op: ">=", value: 1 },
      sticky: true,
      targets: [{ testId: "node-{queue}", tip: msg("tutorials.capacity.backlogGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{queue}" }],
    },
    {
      id: "fix",
      title: msg("tutorials.capacity.fixTitle"),
      goal: msg("tutorials.capacity.fixGoal"),
      done: msg("tutorials.capacity.fixDone"),
      check: { kind: "metric", subject: "worker", field: "replicas", op: ">=", value: 3 },
      targets: [{ testId: "bottleneck-apply", tip: msg("tutorials.capacity.fixGoal") }],
      demo: [{ kind: "applyFix" }],
      solution: [{ click: "bottleneck-apply" }],
    },
    {
      id: "drain",
      title: msg("tutorials.capacity.drainTitle"),
      goal: msg("tutorials.capacity.drainGoal"),
      done: msg("tutorials.capacity.drainDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "metric", subject: "worker", field: "replicas", op: ">=", value: 3 },
          { kind: "metric", subject: "queue", field: "backlog", op: "<=", value: 0 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{queue}", tip: msg("tutorials.capacity.drainGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{queue}" }],
    },
  ],
  finish: { text: msg("tutorials.capacity.finish") },
  quarantined: true,
};
