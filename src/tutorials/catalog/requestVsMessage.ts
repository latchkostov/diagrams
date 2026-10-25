import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

export const requestVsMessage: Tutorial = {
  id: "request-vs-message",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 2,
  title: msg("tutorials.requestVsMessage.title"),
  summary: msg("tutorials.requestVsMessage.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.requestVsMessage.diagramTitle"),
    nodes: [
      {
        id: "app",
        stencil: "client.mobile",
        label: t("tutorials.requestVsMessage.appName"),
        x: 0,
        y: 0,
        props: { rate: 20 },
      },
      { id: "api", stencil: "generic.service", label: t("tutorials.requestVsMessage.apiName"), x: 320, y: 0 },
      { id: "topic", stencil: "kafka.topic", label: t("tutorials.requestVsMessage.topicName"), x: 640, y: 0 },
    ],
    edges: [{ id: "call", from: "app", to: "api", kind: "sync", label: t("tutorials.requestVsMessage.edgeLabel") }],
    simulations: [
      {
        id: "steady-orders",
        title: t("tutorials.requestVsMessage.simulationTitle"),
        seed: 7,
        durationMs: 600000,
        traffic: [{ id: "orders", node: "app", shape: { kind: "constant", ratePerSec: 20, durationMs: 600000 } }],
      },
    ],
  }),
  subjects: {
    app: { stencils: ["client.mobile"] },
    api: { role: "processor" },
    topic: { stencils: ["kafka.topic"] },
    call: { edge: ["app", "api"] },
  },
  steps: [
    {
      id: "connect",
      title: msg("tutorials.requestVsMessage.connectTitle"),
      goal: msg("tutorials.requestVsMessage.connectGoal"),
      done: msg("tutorials.requestVsMessage.connectDone"),
      check: { kind: "relation", from: "api", to: "topic", relation: "flow", edgeKind: "async" },
      targets: [
        { testId: "handle-{api}-right", tip: msg("tutorials.requestVsMessage.connectGoal") },
        { testId: "node-{topic}", tip: msg("tutorials.requestVsMessage.connectGoal") },
      ],
      demo: [{ kind: "connect", from: "api", to: "topic" }],
      solution: [{ drag: "handle-{api}-right", to: "node-{topic}" }],
    },
    {
      id: "live",
      title: msg("tutorials.requestVsMessage.liveTitle"),
      goal: msg("tutorials.requestVsMessage.liveGoal"),
      done: msg("tutorials.requestVsMessage.liveDone"),
      check: { kind: "all", checks: [{ kind: "live" }, { kind: "simulation", id: "steady-orders" }] },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.requestVsMessage.liveGoal") },
        { testId: "live-toggle", tip: msg("tutorials.requestVsMessage.liveGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "steady-orders" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "steady-orders" }],
    },
    {
      id: "watch",
      title: msg("tutorials.requestVsMessage.watchTitle"),
      goal: msg("tutorials.requestVsMessage.watchGoal"),
      check: { kind: "metric", subject: "topic", field: "processed", op: ">=", value: 10 },
      targets: [{ testId: "node-{topic}", tip: msg("tutorials.requestVsMessage.watchGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{topic}" }],
      sticky: true,
    },
    {
      id: "flip",
      title: msg("tutorials.requestVsMessage.flipTitle"),
      goal: msg("tutorials.requestVsMessage.flipGoal"),
      done: msg("tutorials.requestVsMessage.flipDone"),
      check: { kind: "relation", from: "app", to: "api", relation: "flow", edgeKind: "async" },
      targets: [
        { testId: "context-menu-item-relation:message", tip: msg("tutorials.requestVsMessage.flipGoal") },
        { testId: "edge-label-{call}", tip: msg("tutorials.requestVsMessage.flipGoal") },
      ],
      demo: [{ kind: "relation", from: "app", to: "api", relation: "flow", edgeKind: "async" }],
      solution: [
        { rightclick: "edge-label-{call}" },
        { click: "context-menu-item-edge.relationship" },
        { click: "context-menu-item-relation:message" },
      ],
    },
    {
      id: "watch-api",
      title: msg("tutorials.requestVsMessage.watchApiTitle"),
      goal: msg("tutorials.requestVsMessage.watchApiGoal"),
      check: {
        kind: "all",
        checks: [
          { kind: "relation", from: "app", to: "api", edgeKind: "async" },
          { kind: "metric", subject: "api", field: "processed", op: ">=", value: 10 },
        ],
      },
      targets: [{ testId: "node-{api}", tip: msg("tutorials.requestVsMessage.watchApiGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{api}" }],
      sticky: true,
    },
  ],
  finish: {
    text: msg("tutorials.requestVsMessage.finish"),
    example: { slug: "blocking-call", label: msg("tutorials.requestVsMessage.example") },
  },
};
