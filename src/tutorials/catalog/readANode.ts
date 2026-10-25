import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const readANode: Tutorial = {
  id: "read-a-node",
  version: 1,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.readANode.title"),
  summary: msg("tutorials.readANode.summary"),
  start: { example: "kafka-order-pipeline" },
  subjects: { service: { stencils: ["service.dotnet"] } },
  steps: [
    {
      id: "live",
      title: msg("tutorials.readANode.liveTitle"),
      goal: msg("tutorials.readANode.liveGoal"),
      done: msg("tutorials.readANode.liveDone"),
      check: { kind: "simulation", id: "black-friday" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.readANode.liveGoal") },
        { testId: "live-toggle", tip: msg("tutorials.readANode.liveGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "black-friday" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "black-friday" }],
    },
    {
      id: "readout",
      title: msg("tutorials.readANode.readoutTitle"),
      goal: msg("tutorials.readANode.readoutGoal"),
      done: msg("tutorials.readANode.readoutDone"),
      check: { kind: "readout", subject: "service" },
      sticky: true,
      targets: [{ testId: "node-{service}", tip: msg("tutorials.readANode.readoutGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{service}" }],
    },
    {
      id: "events",
      title: msg("tutorials.readANode.eventsTitle"),
      goal: msg("tutorials.readANode.eventsGoal"),
      done: msg("tutorials.readANode.eventsDone"),
      check: { kind: "liveView", view: "events", open: true },
      targets: [{ testId: "live-events-toggle", tip: msg("tutorials.readANode.eventsGoal") }],
      demo: [{ kind: "openView", view: "events" }],
      solution: [{ click: "live-more" }, { click: "live-events-toggle" }],
    },
  ],
  finish: { text: msg("tutorials.readANode.finish") },
};
