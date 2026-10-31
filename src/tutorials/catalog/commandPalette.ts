import { createdNodeLabel, stencilSearch } from "./searchValues";
import { stencilLabel } from "../../i18n/stencils";
import { getStencil } from "../../stencils/registry";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
const topicName = createdNodeLabel("kafka.topic");
const gotoGoalWords = () => t("tutorials.commandPalette.gotoGoal", { query: topicName() });
const gotoTipWords = () => t("tutorials.commandPalette.gotoTip", { query: topicName() });

const addGoalWords = () =>
  t("tutorials.commandPalette.addGoalV2", {
    query: stencilSearch("kafka.topic")(),
    command: t("chrome.addValue", { name: stencilLabel(getStencil("kafka.topic")) }),
  });
const addTipWords = () =>
  t("tutorials.commandPalette.addTipV2", {
    query: stencilSearch("kafka.topic")(),
    command: t("chrome.addValue", { name: stencilLabel(getStencil("kafka.topic")) }),
  });

export const commandPalette: Tutorial = {
  id: "command-palette",
  version: 2,
  track: "basics",
  level: 2,
  minutes: 3,
  title: msg("tutorials.commandPalette.title"),
  summary: msg("tutorials.commandPalette.summaryV2"),
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
      goal: addGoalWords,
      done: msg("tutorials.commandPalette.addDone"),
      check: { kind: "node", subject: "topic" },
      targets: [
        { testId: "command-input", tip: addTipWords },
        { testId: "canvas-pane", tip: addTipWords },
      ],
      demo: [{ kind: "add", subject: "topic", stencil: "kafka.topic" }],
      solution: [
        { press: "ControlOrMeta+k" },
        { fill: "command-input", text: stencilSearch("kafka.topic") },
        { click: "command-item-stencil:kafka.topic" },
      ],
    },
    {
      id: "goto",
      title: msg("tutorials.commandPalette.gotoTitle"),
      goal: gotoGoalWords,
      done: msg("tutorials.commandPalette.gotoDone"),
      check: { kind: "navigation", subject: "topic" },
      sticky: true,
      targets: [{ testId: "node-{topic}", tip: gotoTipWords }],
      demo: [],
      solution: [
        { press: "ControlOrMeta+k" },
        { fill: "command-input", text: topicName },
        { click: "command-item-node:{topic}" },
      ],
    },
    {
      id: "action",
      title: msg("tutorials.commandPalette.actionTitle"),
      goal: () =>
        t("tutorials.commandPalette.actionGoal", {
          command: t("chrome.nodeProperties"),
          description: t("tutorials.commandPalette.description"),
        }),
      done: msg("tutorials.commandPalette.actionDone"),
      check: { kind: "field", subject: "topic", field: "description", is: msg("tutorials.commandPalette.description") },
      targets: [
        {
          testId: "node-{topic}",
          tip: () => t("tutorials.commandPalette.actionTip", { command: t("chrome.nodeProperties") }),
        },
      ],
      demo: [
        { kind: "field", subject: "topic", field: "description", value: msg("tutorials.commandPalette.description") },
      ],
      solution: [
        { press: "ControlOrMeta+k" },
        { fill: "command-input", text: msg("chrome.nodeProperties") },
        { click: "command-item-action:node.properties" },
        { fill: "inspector-field-node-description", text: msg("tutorials.commandPalette.description") },
      ],
    },
  ],
  finish: { text: msg("tutorials.commandPalette.finishV2") },
};
