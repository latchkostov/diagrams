import { stencilSearch } from "./searchValues";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { connectedStep, liveStep, practiceRun } from "./buildingBlocks";

const billingGoalWords = () =>
  t("tutorials.kafkaTopic.billingGoal", { name: msg("tutorials.kafkaTopic.billingName")() });
const emailGoalWords = () => t("tutorials.kafkaTopic.emailGoal", { name: msg("tutorials.kafkaTopic.emailName")() });

export const kafkaTopic: Tutorial = {
  id: "kafka-topic",
  version: 2,
  track: "blocks",
  level: 1,
  minutes: 4,
  title: msg("tutorials.kafkaTopic.title"),
  summary: msg("tutorials.kafkaTopic.summaryVerified"),
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
      search: stencilSearch("kafka.topic"),
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
      search: stencilSearch("generic.service"),
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
      search: stencilSearch("generic.service"),
      name: msg("tutorials.kafkaTopic.emailName"),
      title: msg("tutorials.kafkaTopic.emailTitle"),
      goal: emailGoalWords,
      done: msg("tutorials.kafkaTopic.emailDone"),
    }),
    {
      id: "group-billing",
      title: msg("tutorials.kafkaTopic.billingGroupTitle"),
      goal: () => t("tutorials.kafkaTopic.billingGroupGoal", { group: "billing" }),
      done: msg("tutorials.kafkaTopic.groupDone"),
      check: { kind: "prop", edge: ["topic", "billing"], prop: "group", op: "=", value: "billing" },
      targets: [{ testId: "node-{billing}", tip: msg("tutorials.kafkaTopic.billingGroupTitle") }],
      demo: [{ kind: "prop", edge: ["topic", "billing"], props: { group: "billing" } }],
      solution: [
        { click: "node-{billing}" },
        { press: "Control+Alt+[" },
        // eslint-disable-next-line local/no-literal-ui-text -- stable consumer-group identity, not a display label
        { fill: "inspector-field-group", text: "billing" },
        { press: "Enter" },
      ],
    },
    {
      id: "group-email",
      title: msg("tutorials.kafkaTopic.emailGroupTitle"),
      goal: () => t("tutorials.kafkaTopic.emailGroupGoal", { group: "email" }),
      done: msg("tutorials.kafkaTopic.groupDone"),
      check: { kind: "prop", edge: ["topic", "email"], prop: "group", op: "=", value: "email" },
      targets: [{ testId: "node-{email}", tip: msg("tutorials.kafkaTopic.emailGroupTitle") }],
      demo: [{ kind: "prop", edge: ["topic", "email"], props: { group: "email" } }],
      solution: [
        { click: "node-{email}" },
        { press: "Control+Alt+[" },
        // eslint-disable-next-line local/no-literal-ui-text -- stable consumer-group identity, not a display label
        { fill: "inspector-field-group", text: "email" },
        { press: "Enter" },
      ],
    },
    liveStep(
      msg("tutorials.kafkaTopic.liveTitle"),
      msg("tutorials.kafkaTopic.liveGoal"),
      msg("tutorials.kafkaTopic.liveDone"),
    ),
    {
      id: "watch",
      title: msg("tutorials.kafkaTopic.watchTitle"),
      goal: () =>
        t("tutorials.kafkaTopic.watchGroupsGoal", {
          billing: t("tutorials.kafkaTopic.billingName"),
          email: t("tutorials.kafkaTopic.emailName"),
          billingGroup: "billing",
          emailGroup: "email",
        }),
      done: msg("tutorials.kafkaTopic.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "tutorial-flow" },
          { kind: "prop", edge: ["topic", "billing"], prop: "group", op: "=", value: "billing", effective: true },
          { kind: "prop", edge: ["topic", "email"], prop: "group", op: "=", value: "email", effective: true },
          { kind: "metric", subject: "billing", field: "processed", op: ">=", value: 10 },
          { kind: "metric", subject: "email", field: "processed", op: ">=", value: 10 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{topic}", tip: msg("tutorials.kafkaTopic.watchTitle"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{topic}" }],
    },
  ],
  finish: {
    text: msg("tutorials.kafkaTopic.finishVerified"),
    example: { slug: "kafka-order-pipeline", label: msg("tutorials.kafkaTopic.example") },
  },
};
