import { stencilSearch } from "./searchValues";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import type { DiagramFile } from "../../model/types";

const apiName = msg("tutorials.mobileApi.apiName");
const appWord = stencilSearch("client.mobile");

/** The pilot: independent placement, a real connection, naming and a first look at Live. */
export const mobileApi: Tutorial & { start(): DiagramFile } = {
  id: "mobile-api",
  version: 2,
  track: "basics",
  level: 1,
  minutes: 3,
  title: msg("tutorials.mobileApi.title"),
  summary: msg("tutorials.mobileApi.summaryV2"),
  start: () => ({ format: "diagrams/v1", title: t("tutorials.mobileApi.diagramTitle"), nodes: [], edges: [] }),
  subjects: {
    app: { stencils: ["client.mobile"] },
    api: { role: "processor" },
  },
  steps: [
    {
      id: "add-app",
      title: msg("tutorials.mobileApi.addAppTitle"),
      goal: () => t("tutorials.mobileApi.addAppGoal", { word: appWord() }),
      hint: msg("tutorials.mobileApi.addAppHint"),
      done: msg("tutorials.mobileApi.addAppDone"),
      check: { kind: "node", subject: "app" },
      targets: [
        { testId: "palette-item-client.mobile", tip: msg("tutorials.mobileApi.addAppTipItem") },
        { testId: "palette-search", tip: () => t("tutorials.mobileApi.addAppTipSearch", { word: appWord() }) },
        { testId: "rail-add", tip: msg("tutorials.mobileApi.addAppTipRail") },
      ],
      demo: [{ kind: "add", subject: "app", stencil: "client.mobile" }],
      solution: [
        { click: "rail-add" },
        { fill: "palette-search", text: appWord },
        { click: "palette-item-client.mobile" },
      ],
    },
    {
      id: "add-api",
      title: msg("tutorials.mobileApi.addApiTitle"),
      goal: msg("tutorials.mobileApi.addApiGoalV2"),
      hint: msg("tutorials.mobileApi.addApiHintV2"),
      done: msg("tutorials.mobileApi.addApiDoneV2"),
      check: { kind: "node", subject: "api" },
      targets: [{ testId: "rail-add", tip: msg("tutorials.mobileApi.addApiTitle") }],
      demo: [{ kind: "add", subject: "api", stencil: "generic.service" }],
      solution: [
        { click: "canvas-pane" },
        { click: "rail-add" },
        { fill: "palette-search", text: stencilSearch("generic.service") },
        { click: "palette-item-generic.service" },
      ],
    },
    {
      id: "connect",
      title: msg("tutorials.mobileApi.connectTitle"),
      goal: msg("tutorials.mobileApi.connectGoal"),
      hint: msg("tutorials.mobileApi.connectHint"),
      done: msg("tutorials.mobileApi.connectDone"),
      check: { kind: "edge", from: "app", to: "api" },
      targets: [{ testId: "handle-{app}-right", tip: msg("tutorials.mobileApi.connectTip") }],
      demo: [{ kind: "connect", from: "app", to: "api" }],
      solution: [{ drag: "handle-{app}-right", to: "node-{api}" }],
    },
    {
      id: "name-api",
      title: msg("tutorials.mobileApi.nameTitle"),
      goal: () => t("tutorials.mobileApi.nameGoal", { name: apiName() }),
      hint: msg("tutorials.mobileApi.nameHint"),
      done: msg("tutorials.mobileApi.nameDone"),
      check: { kind: "label", subject: "api", is: apiName },
      settle: "naming",
      targets: [
        { testId: "inspector-field-label", tip: msg("tutorials.mobileApi.nameTipLabel"), selected: "api" },
        { testId: "node-{api}", tip: msg("tutorials.mobileApi.nameTipNode") },
      ],
      demo: [{ kind: "rename", subject: "api", label: apiName }],
      solution: [{ dblclick: "node-{api}" }, { fill: "inspector-field-label", text: apiName }, { press: "Enter" }],
    },
    {
      id: "go-live",
      title: msg("tutorials.mobileApi.liveTitle"),
      goal: () => t("tutorials.mobileApi.liveGoal", { live: t("fileDialog.live"), key: "L" }),
      hint: msg("tutorials.mobileApi.liveHint"),
      done: msg("tutorials.mobileApi.liveDone"),
      check: { kind: "live" },
      targets: [{ testId: "live-toggle", tip: msg("tutorials.mobileApi.liveTip") }],
      demo: [{ kind: "live" }],
      solution: [{ click: "live-toggle" }],
    },
    {
      id: "watch",
      title: msg("tutorials.mobileApi.watchTitle"),
      goal: () => t("tutorials.mobileApi.watchGoal", { name: apiName() }),
      hint: msg("tutorials.mobileApi.watchHint"),
      check: { kind: "processed", subject: "api", atLeast: 10 },
      sticky: true,
      targets: [{ testId: "node-{api}", tip: msg("tutorials.mobileApi.watchTip"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{api}" }],
    },
  ],
  finish: {
    text: msg("tutorials.mobileApi.finishV2"),
    example: { slug: "kafka-order-pipeline", label: msg("tutorials.mobileApi.example") },
  },
};
