import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { practiceRun, liveStep } from "./buildingBlocks";
import { moment } from "./waitingSteps";

export const backlogLag: Tutorial = {
  id: "backlog-lag",
  version: 1,
  track: "waiting",
  level: 1,
  minutes: 3,
  // owner decision pending: 8 (Build 07, backlog-lag Add a consumer test id).
  quarantined: true,
  title: msg("tutorials.backlogLag.title"),
  summary: msg("tutorials.backlogLag.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.backlogLag.title"),
    nodes: [
      {
        id: "producer",
        stencil: "client.mobile",
        label: t("tutorials.backlogLag.producer"),
        x: 0,
        y: 0,
        props: { ratePerSec: 30, jitter: 0 },
      },
      { id: "queue", stencil: "aws.sqs", label: t("tutorials.backlogLag.queue"), x: 300, y: 0 },
      {
        id: "worker",
        stencil: "generic.service",
        label: t("tutorials.backlogLag.worker"),
        x: 600,
        y: 0,
        props: { concurrency: 1, latencyMs: 50, jitter: 0 },
      },
    ],
    edges: [
      { id: "produce", from: "producer", to: "queue", kind: "async", props: { travelMs: 10 } },
      { id: "consume", from: "queue", to: "worker", kind: "async", props: { travelMs: 10 } },
    ],
    simulations: [practiceRun(msg("tutorials.backlogLag.runName"))],
  }),
  subjects: {
    producer: { stencils: ["client.mobile"] },
    queue: { stencils: ["aws.sqs"] },
    worker: { stencils: ["generic.service"] },
  },
  steps: [
    liveStep(
      msg("tutorials.backlogLag.liveTitle"),
      msg("tutorials.backlogLag.liveGoal"),
      msg("tutorials.backlogLag.liveDone"),
    ),
    moment(
      "backlog-50",
      "queue",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "tutorial-flow", traffic: true },
          // Seed 20261024 at 8 s: backlog >= 50 / 0.7 (verified in waiting.test.ts), a 30% margin.
          { kind: "compare", left: { node: "queue", metric: "backlog" }, op: ">=", right: 50 },
        ],
      },
      {
        title: msg("tutorials.backlogLag.backlogTitle"),
        goal: msg("tutorials.backlogLag.backlogGoal"),
        done: msg("tutorials.backlogLag.backlogDone"),
      },
    ),
    // Blocked with decision 8: this slow-reader Trouble offers Inputs, not Add a consumer.
    // Adding a node also restarts Live; sinceStep cannot compare the previous run's backlog.
  ],
  finish: { text: msg("tutorials.backlogLag.finish") },
};
