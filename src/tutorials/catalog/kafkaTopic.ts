import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { connectedStep, liveStep, practiceRun } from "./buildingBlocks";

const billingGoalWords = () =>
  t("tutorials.kafkaTopic.billingGoal", { name: msg("tutorials.kafkaTopic.billingName")() });
const emailGoalWords = () => t("tutorials.kafkaTopic.emailGoal", { name: msg("tutorials.kafkaTopic.emailName")() });

export const kafkaTopic: Tutorial = {
  id: "kafka-topic",
  version: 1,
  track: "blocks",
  level: 1,
  minutes: 4,
  title: msg("tutorials.kafkaTopic.title"),
  summary: msg("tutorials.kafkaTopic.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.kafkaTopic.title"),
    nodes: [
      {
        id: "app",
        stencil: "client.mobile",
        label: t("tutorials.kafkaTopic.appName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 8 },
      },
      { id: "producer", stencil: "generic.service", label: t("tutorials.kafkaTopic.producerName"), x: 240, y: 0 },
    ],
    edges: [{ id: "app-producer", from: "app", to: "producer", kind: "sync" }],
    simulations: [practiceRun(msg("tutorials.kafkaTopic.runName"))],
  }),
  subjects: {
    app: { stencils: ["client.mobile"] },
    producer: { stencils: ["generic.service"] },
    topic: { stencils: ["kafka.topic"] },
    billing: { stencils: ["generic.service"] },
    email: { stencils: ["generic.service"] },
  },
  steps: [
    connectedStep({
      hint: msg("tutorials.kafkaTopic.addHint"),
      id: "add-topic",
      from: "producer",
      subject: "topic",
      stencil: "kafka.topic",
      search: msg("tutorials.kafkaTopic.searchTopic"),
      title: msg("tutorials.kafkaTopic.addTopicTitle"),
      goal: msg("tutorials.kafkaTopic.addTopicGoal"),
      done: msg("tutorials.kafkaTopic.addTopicDone"),
    }),
    connectedStep({
      hint: msg("tutorials.kafkaTopic.addHint"),
      id: "consumer-billing",
      from: "topic",
      subject: "billing",
      stencil: "generic.service",
      search: msg("tutorials.kafkaTopic.searchService"),
      name: msg("tutorials.kafkaTopic.billingName"),
      title: msg("tutorials.kafkaTopic.billingTitle"),
      goal: billingGoalWords,
      done: msg("tutorials.kafkaTopic.billingDone"),
    }),
    connectedStep({
      hint: msg("tutorials.kafkaTopic.addHint"),
      id: "consumer-email",
      from: "topic",
      subject: "email",
      stencil: "generic.service",
      search: msg("tutorials.kafkaTopic.searchService"),
      name: msg("tutorials.kafkaTopic.emailName"),
      title: msg("tutorials.kafkaTopic.emailTitle"),
      goal: emailGoalWords,
      done: msg("tutorials.kafkaTopic.emailDone"),
    }),
    liveStep(
      msg("tutorials.kafkaTopic.liveTitle"),
      msg("tutorials.kafkaTopic.liveGoal"),
      msg("tutorials.kafkaTopic.liveDone"),
    ),
    {
      id: "watch",
      title: msg("tutorials.kafkaTopic.watchTitle"),
      goal: msg("tutorials.kafkaTopic.watchGoal"),
      done: msg("tutorials.kafkaTopic.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "tutorial-flow" },
          { kind: "metric", subject: "billing", field: "processed", op: ">=", value: 10 },
          { kind: "metric", subject: "email", field: "processed", op: ">=", value: 10 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{topic}", tip: msg("tutorials.kafkaTopic.watchGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{topic}" }],
    },
  ],
  finish: {
    text: msg("tutorials.kafkaTopic.finish"),
    example: { slug: "kafka-order-pipeline", label: msg("tutorials.kafkaTopic.example") },
  },
};
