import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { practiceRun, liveStep } from "./buildingBlocks";
import { moment } from "./waitingSteps";

export const backlogLag: Tutorial = {
  id: "backlog-lag",
  version: 2,
  track: "waiting",
  level: 1,
  minutes: 3,
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
        props: { ratePerSec: 10, jitter: 0 },
      },
      { id: "queue", stencil: "aws.sqs", label: t("tutorials.backlogLag.queue"), x: 300, y: 0 },
    ],
    edges: [{ id: "produce", from: "producer", to: "queue", kind: "async", props: { travelMs: 10 } }],
    simulations: [practiceRun(msg("tutorials.backlogLag.runName"))],
  }),
  subjects: {
    producer: { stencils: ["client.mobile"] },
    queue: { stencils: ["aws.sqs"] },
    worker: { stencils: ["generic.service"], downstreamOf: "queue" },
  },
  steps: [
    {
      ...liveStep(
        msg("tutorials.backlogLag.liveTitle"),
        msg("tutorials.backlogLag.liveGoal"),
        msg("tutorials.backlogLag.liveDone"),
      ),
      sticky: true,
    },
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
    {
      id: "add-consumer",
      title: msg("tutorials.backlogLag.addTitle"),
      goal: msg("tutorials.backlogLag.addGoal"),
      done: msg("tutorials.backlogLag.addDone"),
      check: { kind: "edge", from: "queue", to: "worker" },
      targets: [{ testId: "trouble-add-consumer", tip: msg("tutorials.backlogLag.addGoal"), dim: false }],
      demo: [{ kind: "add", subject: "worker", stencil: "generic.service", after: "queue" }],
      solution: [{ click: "trouble-add-consumer" }],
    },
    moment(
      "consumer-progress",
      "worker",
      {
        kind: "all",
        checks: [
          { kind: "processed", subject: "worker", atLeast: 50 },
          { kind: "compare", left: { node: "queue", metric: "backlog" }, op: "<=", right: 10 },
        ],
      },
      {
        title: msg("tutorials.backlogLag.progressTitle"),
        goal: msg("tutorials.backlogLag.progressGoal"),
        done: msg("tutorials.backlogLag.progressDone"),
      },
    ),
  ],
  finish: { text: msg("tutorials.backlogLag.finishV3") },
};
