import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const webhooks: Tutorial = {
  id: "webhooks",
  version: 1,
  track: "blocks",
  level: 2,
  minutes: 3,
  title: msg("tutorials.webhooks.title"),
  summary: msg("tutorials.webhooks.summary"),
  start: { example: "webhook-ingestion" },
  subjects: { queue: { stencils: ["rabbitmq.queue"] } },
  steps: [
    {
      id: "run-outage",
      title: msg("tutorials.webhooks.runTitle"),
      goal: msg("tutorials.webhooks.runGoal"),
      done: msg("tutorials.webhooks.runDone"),
      check: { kind: "simulation", id: "outage-replay" },
      sticky: true,
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.webhooks.runGoal") },
        { testId: "live-toggle", tip: msg("tutorials.webhooks.runGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "outage-replay" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "outage-replay" }],
    },
    {
      id: "continue-note",
      title: msg("tutorials.webhooks.noteTitle"),
      goal: msg("tutorials.webhooks.noteGoal"),
      done: msg("tutorials.webhooks.noteDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "outage-replay", atLeastMs: 6500 },
          { kind: "note", waiting: false },
        ],
      },
      sticky: true,
      targets: [
        { testId: "live-note-continue", tip: msg("tutorials.webhooks.noteGoal"), dim: false },
        { testId: "live-note", tip: msg("tutorials.webhooks.noteGoal"), dim: false },
      ],
      demo: [{ kind: "continueNote", simulation: "outage-replay", atLeastMs: 6500 }],
      solution: [{ click: "live-note-continue" }],
    },
    {
      id: "expect-parked",
      title: msg("tutorials.webhooks.expectTitle"),
      goal: msg("tutorials.webhooks.expectGoal"),
      done: msg("tutorials.webhooks.expectDone"),
      // eslint-disable-next-line local/no-literal-ui-text -- stable saved expectation id, not its displayed label
      check: { kind: "expectation", simulation: "outage-replay", label: "parked" },
      sticky: true,
      targets: [{ testId: "node-{queue}", tip: msg("tutorials.webhooks.expectGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{queue}" }],
    },
  ],
  finish: { text: msg("tutorials.webhooks.finish") },
};
