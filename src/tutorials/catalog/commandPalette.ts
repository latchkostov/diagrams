import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
export const commandPalette: Tutorial = {
  id: "command-palette",
  version: 1,
  track: "basics",
  level: 2,
  minutes: 2,
  title: msg("tutorials.commandPalette.title"),
  summary: msg("tutorials.commandPalette.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.commandPalette.diagramTitle"),
    nodes: [
      { id: "seed-0", stencil: "generic.service", label: t("tutorials.commandPalette.service1"), x: 0, y: 0 },
      { id: "seed-1", stencil: "generic.service", label: t("tutorials.commandPalette.service2"), x: 320, y: 160 },
    ],
    edges: [],
  }),
  subjects: { anchor: { role: "processor" }, topic: { stencils: ["kafka.topic"] } },
  steps: [
    {
      id: "add",
      title: msg("tutorials.commandPalette.addTitle"),
      goal: msg("tutorials.commandPalette.addGoal"),
      done: msg("tutorials.commandPalette.addDone"),
      check: { kind: "node", subject: "topic" },
      settle: { kind: "selection", subjects: ["anchor"], tip: msg("tutorials.commandPalette.finishAdd") },
      targets: [{ testId: "canvas-pane", tip: msg("tutorials.commandPalette.addTip") }],
      demo: [{ kind: "add", subject: "topic", stencil: "kafka.topic" }],
      solution: [
        { press: "ControlOrMeta+k" },
        { fill: "command-input", text: msg("tutorials.commandPalette.searchKafka") },
        { click: "command-item-stencil:kafka.topic" },
        { click: "node-{anchor}" },
      ],
    },
    {
      id: "goto",
      title: msg("tutorials.commandPalette.gotoTitle"),
      goal: msg("tutorials.commandPalette.gotoGoal"),
      done: msg("tutorials.commandPalette.gotoDone"),
      check: { kind: "selection", subjects: ["topic"], exact: true },
      targets: [{ testId: "node-{topic}", tip: msg("tutorials.commandPalette.gotoTip") }],
      demo: [{ kind: "select", subjects: ["topic"] }],
      solution: [
        { press: "ControlOrMeta+k" },
        { fill: "command-input", text: msg("tutorials.commandPalette.topicName") },
        { click: "command-item-node:{topic}" },
      ],
    },
  ],
  finish: { text: msg("tutorials.commandPalette.finish") },
};
