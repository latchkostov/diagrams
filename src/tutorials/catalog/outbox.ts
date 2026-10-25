import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const outbox: Tutorial = {
  id: "outbox",
  version: 1,
  track: "blocks",
  level: 2,
  minutes: 3,
  title: msg("tutorials.outbox.title"),
  summary: msg("tutorials.outbox.summary"),
  start: { example: "outbox-saga-checkout" },
  subjects: { saga: { stencils: ["generic.saga"] } },
  steps: [
    {
      id: "trace-message",
      title: msg("tutorials.outbox.traceTitle"),
      goal: msg("tutorials.outbox.traceGoal"),
      done: msg("tutorials.outbox.traceDone"),
      check: { kind: "trace" },
      sticky: true,
      targets: [
        { testId: "live-trace-next", tip: msg("tutorials.outbox.traceGoal") },
        { testId: "live-more", tip: msg("tutorials.outbox.traceGoal") },
        { testId: "live-toggle", tip: msg("tutorials.outbox.traceGoal") },
      ],
      demo: [{ kind: "live" }, { kind: "trace" }],
      solution: [
        { click: "live-toggle" },
        { click: "live-more" },
        { click: "live-trace-message" },
        { click: "live-trace-next" },
      ],
    },
    {
      id: "run-happy-path",
      title: msg("tutorials.outbox.happyTitle"),
      goal: msg("tutorials.outbox.happyGoal"),
      done: msg("tutorials.outbox.happyDone"),
      check: { kind: "simulation", id: "happy-path" },
      sticky: true,
      targets: [{ testId: "live-sim-picker", tip: msg("tutorials.outbox.happyGoal") }],
      demo: [{ kind: "runSimulation", id: "happy-path" }],
      solution: [{ select: "live-sim-picker", value: "happy-path" }, { click: "live-note-continue" }],
    },
    {
      id: "watch-compensation",
      title: msg("tutorials.outbox.declineTitle"),
      goal: msg("tutorials.outbox.declineGoal"),
      done: msg("tutorials.outbox.declineDone"),
      check: { kind: "simulation", id: "declines", atLeastMs: 2500 },
      sticky: true,
      targets: [{ testId: "live-sim-picker", tip: msg("tutorials.outbox.declineGoal") }],
      demo: [{ kind: "runSimulation", id: "declines" }],
      solution: [{ select: "live-sim-picker", value: "declines" }],
    },
  ],
  finish: { text: msg("tutorials.outbox.finish") },
};
