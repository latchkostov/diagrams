import { stencilSearch } from "./searchValues";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { connectedStep, liveStep, practiceRun } from "./buildingBlocks";

export const queueWorkers: Tutorial = {
  id: "queue-workers",
  version: 1,
  track: "blocks",
  level: 1,
  minutes: 3,
  title: msg("tutorials.queueWorkers.title"),
  summary: msg("tutorials.queueWorkers.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.queueWorkers.title"),
    nodes: [
      {
        id: "producer",
        stencil: "client.mobile",
        label: t("tutorials.queueWorkers.producerName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 2 },
      },
      { id: "queue", stencil: "aws.sqs", label: t("tutorials.queueWorkers.queueName"), x: 240, y: 0 },
      { id: "worker", stencil: "generic.service", label: t("tutorials.queueWorkers.workerName"), x: 480, y: -110 },
    ],
    edges: [
      { id: "producer-queue", from: "producer", to: "queue", kind: "async" },
      { id: "queue-worker", from: "queue", to: "worker", kind: "async" },
    ],
    simulations: [practiceRun(msg("tutorials.queueWorkers.runName"))],
  }),
  subjects: {
    producer: { stencils: ["client.mobile"] },
    queue: { stencils: ["aws.sqs"] },
    first: { stencils: ["generic.service"] },
    second: { stencils: ["generic.service"] },
  },
  steps: [
    connectedStep({
      hint: msg("tutorials.queueWorkers.addHint"),
      id: "add-worker",
      from: "queue",
      subject: "second",
      stencil: "generic.service",
      search: stencilSearch("generic.service"),
      title: msg("tutorials.queueWorkers.addWorkerTitle"),
      goal: msg("tutorials.queueWorkers.addWorkerGoal"),
      done: msg("tutorials.queueWorkers.addWorkerDone"),
    }),
    liveStep(
      msg("tutorials.queueWorkers.liveTitle"),
      msg("tutorials.queueWorkers.liveGoal"),
      msg("tutorials.queueWorkers.liveDone"),
    ),
    {
      id: "watch",
      title: msg("tutorials.queueWorkers.watchTitle"),
      goal: msg("tutorials.queueWorkers.watchGoal"),
      done: msg("tutorials.queueWorkers.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "tutorial-flow" },
          { kind: "processed", subject: "first", atLeast: 5 },
          { kind: "processed", subject: "second", atLeast: 5 },
          {
            kind: "compare",
            left: { sum: "processed", nodes: ["first", "second"] },
            op: "=",
            right: {
              sum: "delivered",
              edges: [
                ["queue", "first"],
                ["queue", "second"],
              ],
            },
          },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{queue}", tip: msg("tutorials.queueWorkers.watchGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{queue}" }],
    },
  ],
  finish: { text: msg("tutorials.queueWorkers.finish") },
};
