import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

export const dotsAndSides: Tutorial = {
  id: "dots-and-sides",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 3,
  title: msg("tutorials.dotsAndSides.title"),
  summary: msg("tutorials.dotsAndSides.summary"),
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
      id: "side",
      title: msg("tutorials.dotsAndSides.sideTitle"),
      goal: msg("tutorials.dotsAndSides.sideGoal"),
      done: msg("tutorials.dotsAndSides.sideDone"),
      check: { kind: "prop", edge: ["app", "a"], prop: "targetSide", op: "=", value: "top" },
      targets: [
        { testId: "handle-{a}-top", tip: msg("tutorials.dotsAndSides.sideGoal") },
        { testId: "node-{a}", tip: msg("tutorials.dotsAndSides.sideGoal") },
      ],
      demo: [{ kind: "connect", from: "app", to: "a", sourceSide: "right", targetSide: "top" }],
      solution: [{ drag: "handle-{app}-right", to: "handle-{a}-top" }],
      sticky: true,
    },
    {
      id: "reconnect",
      title: msg("tutorials.dotsAndSides.reconnectTitle"),
      goal: msg("tutorials.dotsAndSides.reconnectGoal"),
      done: msg("tutorials.dotsAndSides.reconnectDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "edge", from: "app", to: "b" },
          { kind: "relation", from: "app", to: "a", absent: true },
        ],
      },
      targets: [
        { testId: "reconnect-{link}-target", tip: msg("tutorials.dotsAndSides.reconnectGoal") },
        { testId: "edge-{link}", tip: msg("tutorials.dotsAndSides.reconnectGoal") },
      ],
      demo: [{ kind: "reconnect", edge: ["app", "a"], to: "b" }],
      solution: [{ click: "edge-{link}" }, { drag: "reconnect-{link}-target", to: "node-{b}" }],
    },
  ],
  finish: { text: msg("tutorials.dotsAndSides.finish") },
};
