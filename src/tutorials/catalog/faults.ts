import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const faults: Tutorial = {
  id: "faults",
  version: 1,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.faults.title"),
  summary: msg("tutorials.faults.summary"),
  start: { example: "zone-outage-drill" },
  subjects: { api: { stencils: ["aws.ecs"] } },
  steps: [
    {
      id: "live",
      title: msg("tutorials.faults.liveTitle"),
      goal: msg("tutorials.faults.liveGoal"),
      done: msg("tutorials.faults.liveDone"),
      check: { kind: "simulation", id: "health-checks" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.faults.liveGoal") },
        { testId: "live-toggle", tip: msg("tutorials.faults.liveGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "health-checks" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "health-checks" }],
    },
    {
      id: "down",
      title: msg("tutorials.faults.downTitle"),
      goal: msg("tutorials.faults.downGoal"),
      done: msg("tutorials.faults.downDone"),
      check: { kind: "fault", subject: "api", fault: "down" },
      sticky: true,
      targets: [
        { testId: "context-menu-item-sim.kill", tip: msg("tutorials.faults.downGoal"), dim: false },
        { testId: "node-{api}", tip: msg("tutorials.faults.downGoal"), dim: false },
      ],
      demo: [{ kind: "fault", subject: "api", fault: "down" }],
      solution: [
        { rightclick: "node-{api}" },
        { click: "context-menu-item-sim.fault" },
        { click: "context-menu-item-sim.kill" },
      ],
    },
    {
      id: "restore",
      title: msg("tutorials.faults.restoreTitle"),
      goal: msg("tutorials.faults.restoreGoal"),
      done: msg("tutorials.faults.restoreDone"),
      check: { kind: "fault", subject: "api", fault: "down", absent: true },
      targets: [
        { testId: "context-menu-item-sim.kill", tip: msg("tutorials.faults.restoreGoal") },
        { testId: "node-{api}", tip: msg("tutorials.faults.restoreGoal") },
      ],
      demo: [{ kind: "fault", subject: "api", fault: "down", restore: true }],
      solution: [
        { rightclick: "node-{api}" },
        { click: "context-menu-item-sim.fault" },
        { click: "context-menu-item-sim.kill" },
      ],
    },
  ],
  finish: { text: msg("tutorials.faults.finish") },
};
