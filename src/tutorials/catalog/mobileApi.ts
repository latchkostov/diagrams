import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

const apiName = msg("tutorials.mobileApi.apiName");
const appWord = msg("tutorials.mobileApi.searchApp");

/** The pilot: static drawing (rail, the "+", dots, naming) and a first look at Live. */
export const mobileApi: Tutorial = {
  id: "mobile-api",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 3,
  title: msg("tutorials.mobileApi.title"),
  summary: msg("tutorials.mobileApi.summary"),
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
        { testId: "palette-toggle", tip: msg("tutorials.mobileApi.addAppTipRail") },
      ],
      demo: [{ kind: "add", subject: "app", stencil: "client.mobile" }],
      solution: [{ fill: "palette-search", text: appWord }, { click: "palette-item-client.mobile" }],
    },
    {
      id: "add-api",
      title: msg("tutorials.mobileApi.addApiTitle"),
      goal: msg("tutorials.mobileApi.addApiGoal"),
      hint: msg("tutorials.mobileApi.addApiHint"),
      done: msg("tutorials.mobileApi.addApiDone"),
      check: { kind: "node", subject: "api" },
      guide: { quickAdd: msg("tutorials.mobileApi.searchApi") },
      targets: [
        // Quick-add lists a stencil used lately under Recent, with its own id.
        { testId: "context-menu-item-quick-add:recent:generic.service", tip: msg("tutorials.mobileApi.addApiTipPick") },
        { testId: "context-menu-item-quick-add:generic.service", tip: msg("tutorials.mobileApi.addApiTipPick") },
        { testId: "grow-chip-{app}", tip: msg("tutorials.mobileApi.addApiTipPlus"), selected: "app" },
        { testId: "node-{app}", tip: msg("tutorials.mobileApi.addApiTipNode") },
      ],
      demo: [{ kind: "add", subject: "api", stencil: "generic.service", after: "app" }],
      solution: [
        { click: "node-{app}" },
        { click: "grow-chip-{app}" },
        // No typing: the step's guide opens quick-add already searched for Service (the e2e proves it).
        { click: "context-menu-item-quick-add:generic.service" },
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
      goal: msg("tutorials.mobileApi.liveGoal"),
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
    text: msg("tutorials.mobileApi.finish"),
    example: { slug: "kafka-order-pipeline", label: msg("tutorials.mobileApi.example") },
  },
};
