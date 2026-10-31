import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const readANode: Tutorial = {
  id: "read-a-node",
  version: 2,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.readANode.title"),
  summary: msg("tutorials.readANode.summaryV2"),
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
      goal: msg("tutorials.readANode.readoutGoalV2"),
      done: msg("tutorials.readANode.readoutDoneV2"),
      check: {
        kind: "all",
        checks: [
          { kind: "selection", subjects: ["service"], exact: true },
          { kind: "dock", tab: "properties" },
          { kind: "processed", subject: "service", atLeast: 1 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{service}", tip: msg("tutorials.readANode.readoutGoalV2"), dim: false }],
      demo: [],
      solution: [{ dblclick: "node-{service}" }],
    },
    {
      id: "interpret",
      title: msg("tutorials.readANode.interpretTitle"),
      goal: msg("tutorials.readANode.interpretGoal"),
      done: msg("tutorials.readANode.interpretDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "inspector-live-section-latency", tip: msg("tutorials.readANode.interpretTitle") }],
      demo: [],
      solution: [{ click: "inspector-live-section-latency" }, { click: "tutorial-skip" }],
    },
    {
      id: "events",
      title: msg("tutorials.readANode.eventsTitle"),
      goal: msg("tutorials.readANode.eventsGoalV2"),
      done: msg("tutorials.readANode.eventsDoneV2"),
      check: {
        kind: "all",
        checks: [
          { kind: "liveView", view: "events", open: true },
          { kind: "event", subject: "service", event: "process" },
        ],
      },
      targets: [{ testId: "live-events-toggle", tip: msg("tutorials.readANode.eventsGoalV2") }],
      demo: [{ kind: "openView", view: "events", subject: "service" }],
      solution: [
        { click: "live-more" },
        { click: "live-events-toggle" },
        { select: "live-events-filter", value: "orders" },
      ],
    },
  ],
  finish: { text: msg("tutorials.readANode.finishV2") },
};
