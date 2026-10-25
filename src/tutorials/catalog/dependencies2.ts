import { msg } from "../../i18n";
import type { Tutorial } from "../types";

const setting = msg("tutorials.dependencies2.setting");
export const dependencies2: Tutorial = {
  id: "dependencies-2",
  version: 1,
  track: "blocks",
  level: 2,
  minutes: 2,
  title: msg("tutorials.dependencies2.title"),
  summary: msg("tutorials.dependencies2.summary"),
  start: { example: "aks-app-config-key-vault" },
  subjects: { api: { stencils: ["service.dotnet"] }, config: { stencils: ["azure.app-config"] } },
  steps: [
    {
      id: "add-setting",
      title: msg("tutorials.dependencies2.addTitle"),
      goal: msg("tutorials.dependencies2.addGoal"),
      done: msg("tutorials.dependencies2.addDone"),
      check: { kind: "prop", edge: ["api", "config"], prop: ["settings"], measure: "length", op: ">=", value: 5 },
      targets: [
        { testId: "inspector-field-settings", tip: msg("tutorials.dependencies2.addGoal") },
        { testId: "edge-label-{api->config}", tip: msg("tutorials.dependencies2.addGoal") },
      ],
      demo: [
        {
          kind: "patch",
          edge: ["api", "config"],
          patches: [{ op: "ensureItem", path: ["settings"], match: { key: setting } }],
        },
      ],
      solution: [
        { click: "edge-label-{api->config}" },
        { click: "inspector-field-settings" },
        { press: "ControlOrMeta+End" },
        { press: "Enter" },
        { type: "inspector-field-settings", text: setting },
      ],
    },
    {
      id: "mark-secret",
      title: msg("tutorials.dependencies2.secretTitle"),
      goal: msg("tutorials.dependencies2.secretGoal"),
      done: msg("tutorials.dependencies2.secretDone"),
      check: { kind: "prop", edge: ["api", "config"], prop: ["settings", 4, "secret"], op: "=", value: true },
      targets: [{ testId: "inspector-setting-lock-4", tip: msg("tutorials.dependencies2.secretGoal") }],
      demo: [
        {
          kind: "patch",
          edge: ["api", "config"],
          patches: [{ op: "set", path: ["settings", 4, "secret"], value: true }],
        },
      ],
      solution: [{ click: "inspector-setting-lock-4" }],
    },
  ],
  finish: { text: msg("tutorials.dependencies2.finish") },
};
