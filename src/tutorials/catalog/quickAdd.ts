import { stencilSearch } from "./searchValues";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

const nameApiGoalWords = () => t("tutorials.quickAdd.nameApiGoal", { name: msg("tutorials.quickAdd.apiName")() });
const growDbGoalWords = () => t("tutorials.quickAdd.growDbGoal", { name: msg("tutorials.quickAdd.apiName")() });

const addAppGoalWords = () => t("tutorials.quickAdd.addAppGoal", { query: stencilSearch("client.browser")() });

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
      goal: addAppGoalWords,
      done: msg("tutorials.quickAdd.addAppDone"),
      check: { kind: "node", subject: "app" },
      targets: [
        { testId: "quick-add-search", tip: addAppGoalWords },
        { testId: "canvas-pane", tip: addAppGoalWords },
      ],
      demo: [{ kind: "add", subject: "app", stencil: "client.browser" }],
      solution: [
        { pane: "dblclick" },
        { fill: "quick-add-search", text: stencilSearch("client.browser") },
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
      guide: { quickAdd: stencilSearch("generic.service") },
    },
    {
      id: "name-api",
      title: msg("tutorials.quickAdd.nameApiTitle"),
      goal: nameApiGoalWords,
      done: msg("tutorials.quickAdd.nameApiDone"),
      check: { kind: "label", subject: "api", is: msg("tutorials.quickAdd.apiName") },
      targets: [
        { testId: "inspector-field-label", tip: nameApiGoalWords },
        { testId: "node-{api}", tip: nameApiGoalWords },
      ],
      demo: [{ kind: "rename", subject: "api", label: msg("tutorials.quickAdd.apiName") }],
      solution: [{ fill: "inspector-field-label", text: msg("tutorials.quickAdd.apiName") }, { press: "Enter" }],
      settle: "naming",
    },
    {
      id: "grow-db",
      title: msg("tutorials.quickAdd.growDbTitle"),
      goal: growDbGoalWords,
      done: msg("tutorials.quickAdd.growDbDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "node", subject: "db" },
          { kind: "edge", from: "api", to: "db" },
        ],
      },
      targets: [
        { testId: "quick-add-search", tip: growDbGoalWords },
        { testId: "node-{api}", tip: growDbGoalWords },
      ],
      demo: [{ kind: "add", subject: "db", stencil: "postgres", after: "api" }],
      solution: [{ click: "node-{api}" }, { press: "Alt+ArrowRight" }, { press: "Enter" }],
      guide: { quickAdd: stencilSearch("postgres") },
    },
  ],
  finish: { text: msg("tutorials.quickAdd.finish") },
};
