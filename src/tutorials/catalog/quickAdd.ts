import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

export const quickAdd: Tutorial = {
  id: "quick-add",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 2,
  title: msg("tutorials.quickAdd.title"),
  summary: msg("tutorials.quickAdd.summary"),
  start: () => ({ format: "diagrams/v1", title: t("tutorials.quickAdd.diagramTitle"), nodes: [], edges: [] }),
  subjects: { app: { stencils: ["client.browser"] }, api: { role: "processor" }, db: { role: "store" } },
  steps: [
    {
      id: "add-app",
      title: msg("tutorials.quickAdd.addAppTitle"),
      goal: msg("tutorials.quickAdd.addAppGoal"),
      done: msg("tutorials.quickAdd.addAppDone"),
      check: { kind: "node", subject: "app" },
      targets: [
        { testId: "quick-add-search", tip: msg("tutorials.quickAdd.addAppGoal") },
        { testId: "canvas-pane", tip: msg("tutorials.quickAdd.addAppGoal") },
      ],
      demo: [{ kind: "add", subject: "app", stencil: "client.browser" }],
      solution: [
        { pane: "dblclick" },
        { fill: "quick-add-search", text: msg("tutorials.quickAdd.searchBrowser") },
        { press: "Enter" },
      ],
    },
    {
      id: "grow",
      title: msg("tutorials.quickAdd.growTitle"),
      goal: msg("tutorials.quickAdd.growGoal"),
      done: msg("tutorials.quickAdd.growDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "node", subject: "api" },
          { kind: "edge", from: "app", to: "api" },
        ],
      },
      targets: [
        { testId: "quick-add-search", tip: msg("tutorials.quickAdd.growGoal") },
        { testId: "node-{app}", tip: msg("tutorials.quickAdd.growGoal") },
      ],
      demo: [{ kind: "add", subject: "api", stencil: "generic.service", after: "app" }],
      solution: [{ click: "node-{app}" }, { press: "Alt+ArrowRight" }, { press: "Enter" }],
      guide: { quickAdd: msg("tutorials.quickAdd.searchService") },
    },
    {
      id: "name-api",
      title: msg("tutorials.quickAdd.nameApiTitle"),
      goal: msg("tutorials.quickAdd.nameApiGoal"),
      done: msg("tutorials.quickAdd.nameApiDone"),
      check: { kind: "label", subject: "api", is: msg("tutorials.quickAdd.apiName") },
      targets: [
        { testId: "inspector-field-label", tip: msg("tutorials.quickAdd.nameApiGoal") },
        { testId: "node-{api}", tip: msg("tutorials.quickAdd.nameApiGoal") },
      ],
      demo: [{ kind: "rename", subject: "api", label: msg("tutorials.quickAdd.apiName") }],
      solution: [{ fill: "inspector-field-label", text: msg("tutorials.quickAdd.apiName") }, { press: "Enter" }],
      settle: "naming",
    },
    {
      id: "grow-db",
      title: msg("tutorials.quickAdd.growDbTitle"),
      goal: msg("tutorials.quickAdd.growDbGoal"),
      done: msg("tutorials.quickAdd.growDbDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "node", subject: "db" },
          { kind: "edge", from: "api", to: "db" },
        ],
      },
      targets: [
        { testId: "quick-add-search", tip: msg("tutorials.quickAdd.growDbGoal") },
        { testId: "node-{api}", tip: msg("tutorials.quickAdd.growDbGoal") },
      ],
      demo: [{ kind: "add", subject: "db", stencil: "postgres", after: "api" }],
      solution: [{ click: "node-{api}" }, { press: "Alt+ArrowRight" }, { press: "Enter" }],
      guide: { quickAdd: msg("tutorials.quickAdd.searchPostgres") },
    },
  ],
  finish: { text: msg("tutorials.quickAdd.finish") },
};
