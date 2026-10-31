import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

export const dotsAndSides: Tutorial = {
  id: "dots-and-sides",
  version: 2,
  track: "basics",
  level: 1,
  minutes: 3,
  title: msg("tutorials.dotsAndSides.title"),
  summary: msg("tutorials.dotsAndSides.summaryV2"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.dotsAndSides.diagramTitle"),
    nodes: [
      { id: "browser", stencil: "client.browser", label: t("tutorials.dotsAndSides.appName"), x: 0, y: 80 },
      { id: "a", stencil: "generic.service", label: t("tutorials.dotsAndSides.aName"), x: 360, y: 0 },
      { id: "b", stencil: "generic.service", label: t("tutorials.dotsAndSides.bName"), x: 360, y: 230 },
    ],
    edges: [],
  }),
  subjects: {
    app: { stencils: ["client.browser"] },
    a: { role: "processor" },
    b: { role: "processor" },
    link: { edge: ["app", "a"] },
  },
  steps: [
    {
      id: "connect",
      title: msg("tutorials.dotsAndSides.connectTitle"),
      goal: msg("tutorials.dotsAndSides.connectGoal"),
      done: msg("tutorials.dotsAndSides.connectDone"),
      check: { kind: "edge", from: "app", to: "a" },
      targets: [{ testId: "handle-{app}-right", tip: msg("tutorials.dotsAndSides.connectGoal") }],
      demo: [{ kind: "connect", from: "app", to: "a", sourceSide: "right" }],
      solution: [{ drag: "handle-{app}-right", to: "node-{a}" }],
      sticky: true,
    },
    {
      id: "describe",
      title: msg("tutorials.dotsAndSides.describeTitle"),
      goal: () => t("tutorials.dotsAndSides.describeGoal", { name: t("tutorials.dotsAndSides.edgeName") }),
      done: msg("tutorials.dotsAndSides.describeDone"),
      check: { kind: "label", subject: "link", is: msg("tutorials.dotsAndSides.edgeName") },
      settle: "naming",
      sticky: true,
      targets: [{ testId: "edge-{link}", tip: msg("tutorials.dotsAndSides.describeTitle") }],
      demo: [{ kind: "rename", subject: "link", label: msg("tutorials.dotsAndSides.edgeName") }],
      solution: [
        { click: "edge-{link}" },
        { press: "Enter" },
        { fill: "inspector-field-label", text: msg("tutorials.dotsAndSides.edgeName") },
        { press: "Enter" },
      ],
    },
    {
      id: "side",
      title: msg("tutorials.dotsAndSides.sideTitle"),
      goal: () => t("tutorials.dotsAndSides.sideGoalV2", { destination: t("tutorials.dotsAndSides.aName") }),
      done: msg("tutorials.dotsAndSides.sideDone"),
      check: { kind: "prop", edge: ["app", "a"], prop: "targetSide", op: "=", value: "top" },
      targets: [
        {
          testId: "handle-{a}-top",
          tip: () => t("tutorials.dotsAndSides.sideGoalV2", { destination: t("tutorials.dotsAndSides.aName") }),
        },
        {
          testId: "node-{a}",
          tip: () => t("tutorials.dotsAndSides.sideGoalV2", { destination: t("tutorials.dotsAndSides.aName") }),
        },
      ],
      demo: [{ kind: "connect", from: "app", to: "a", sourceSide: "right", targetSide: "top" }],
      solution: [{ click: "canvas-pane" }, { drag: "handle-{app}-right", to: "handle-{a}-top" }],
      sticky: true,
    },
    {
      id: "reconnect",
      settle: "naming",
      hint: () => t("tutorials.dotsAndSides.reconnectHint", { destination: t("tutorials.dotsAndSides.bName") }),
      title: msg("tutorials.dotsAndSides.reconnectTitle"),
      goal: () =>
        t("tutorials.dotsAndSides.reconnectGoalV2", {
          name: t("tutorials.dotsAndSides.edgeName"),
          destination: t("tutorials.dotsAndSides.bName"),
        }),
      done: msg("tutorials.dotsAndSides.reconnectDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "edge", from: "app", to: "b" },
          { kind: "label", subject: "link", is: msg("tutorials.dotsAndSides.edgeName") },
          { kind: "relation", from: "app", to: "b", edgeKind: "sync", relation: "flow" },
          { kind: "prop", edge: ["app", "b"], prop: "sourceSide", op: "=", value: "right" },
          { kind: "relation", from: "app", to: "a", absent: true },
        ],
      },
      targets: [
        {
          testId: "reconnect-{link}-target",
          tip: () =>
            t("tutorials.dotsAndSides.reconnectGoalV2", {
              name: t("tutorials.dotsAndSides.edgeName"),
              destination: t("tutorials.dotsAndSides.bName"),
            }),
        },
        {
          testId: "edge-{link}",
          tip: () =>
            t("tutorials.dotsAndSides.reconnectGoalV2", {
              name: t("tutorials.dotsAndSides.edgeName"),
              destination: t("tutorials.dotsAndSides.bName"),
            }),
        },
      ],
      demo: [{ kind: "reconnect", edge: ["app", "a"], to: "b" }],
      solution: [{ click: "edge-{link}" }, { drag: "reconnect-{link}-target", to: "node-{b}" }],
    },
  ],
  finish: { text: msg("tutorials.dotsAndSides.finishV2") },
};
