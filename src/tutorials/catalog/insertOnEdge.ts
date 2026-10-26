import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

const nameGoalWords = () => t("tutorials.insertOnEdge.nameGoal", { name: msg("tutorials.insertOnEdge.gatewayName")() });

const insertGoalWords = () =>
  t("tutorials.insertOnEdge.insertGoal", { query: msg("tutorials.insertOnEdge.searchGateway")() });

export const insertOnEdge: Tutorial = {
  id: "insert-on-edge",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 2,
  title: msg("tutorials.insertOnEdge.title"),
  summary: msg("tutorials.insertOnEdge.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.insertOnEdge.diagramTitle"),
    nodes: [
      { id: "app", stencil: "client.mobile", label: t("tutorials.insertOnEdge.appName"), x: 0, y: 0 },
      { id: "api", stencil: "generic.service", label: t("tutorials.insertOnEdge.apiName"), x: 540, y: 0 },
    ],
    edges: [{ id: "call", from: "app", to: "api", kind: "sync", label: t("tutorials.insertOnEdge.edgeLabel") }],
  }),
  subjects: {
    app: { stencils: ["client.mobile"] },
    api: { role: "processor" },
    gw: { role: "gateway" },
    call: { edge: ["app", "api"] },
  },
  steps: [
    {
      id: "insert",
      title: msg("tutorials.insertOnEdge.insertTitle"),
      goal: insertGoalWords,
      done: msg("tutorials.insertOnEdge.insertDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "edge", from: "app", to: "gw" },
          { kind: "edge", from: "gw", to: "api" },
          { kind: "relation", from: "app", to: "api", absent: true },
        ],
      },
      targets: [
        { testId: "context-menu-item-edge.insert-node", tip: insertGoalWords },
        { testId: "edge-label-{call}", tip: insertGoalWords },
      ],
      demo: [{ kind: "insert", edge: ["app", "api"], subject: "gw", stencil: "aws.api-gateway" }],
      solution: [
        { rightclick: "edge-label-{call}" },
        { click: "context-menu-item-edge.insert-node" },
        { type: msg("tutorials.insertOnEdge.searchGateway") },
        { press: "Enter" },
      ],
    },
    {
      id: "name",
      title: msg("tutorials.insertOnEdge.nameTitle"),
      goal: nameGoalWords,
      done: msg("tutorials.insertOnEdge.nameDone"),
      check: { kind: "label", subject: "gw", is: msg("tutorials.insertOnEdge.gatewayName") },
      targets: [
        { testId: "inspector-field-label", tip: nameGoalWords },
        { testId: "node-{gw}", tip: nameGoalWords },
      ],
      demo: [{ kind: "rename", subject: "gw", label: msg("tutorials.insertOnEdge.gatewayName") }],
      solution: [
        { fill: "inspector-field-label", text: msg("tutorials.insertOnEdge.gatewayName") },
        { press: "Enter" },
      ],
      settle: "naming",
    },
  ],
  finish: { text: msg("tutorials.insertOnEdge.finish") },
};
