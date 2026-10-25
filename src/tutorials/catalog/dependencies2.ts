import { msg } from "../../i18n";
import type { Tutorial } from "../types";

// Example configuration keys retain their bytes across languages.
const setting = "Notifications:Token";
const lockTarget = `inspector-setting-lock-key-${setting}`;
export const dependencies2: Tutorial = {
  id: "dependencies-2",
  version: 2,
  track: "blocks",
  level: 2,
  minutes: 2,
  title: msg("tutorials.dependencies2.title"),
  summary: msg("tutorials.dependencies2.summary"),
  start: { example: "aks-app-config-key-vault" },
  subjects: { api: { stencils: ["service.dotnet"] }, config: { stencils: ["azure.app-config"] } },
  steps: [
    {
      id: "show-dependencies",
      title: msg("tutorials.dependencies2.showTitle"),
      goal: msg("tutorials.dependencies2.showGoal"),
      check: { kind: "dependencies", visible: true },
      targets: [{ testId: "canvas-pane", tip: msg("tutorials.dependencies2.showGoal") }],
      demo: [],
      solution: [
        { rightclick: "canvas-pane" },
        { hover: "context-menu-item-canvas.view-options" },
        { click: "context-menu-item-view:dependencies" },
      ],
      sticky: true,
    },
    {
      id: "add-setting",
      title: msg("tutorials.dependencies2.addTitle"),
      goal: msg("tutorials.dependencies2.addGoal"),
      done: msg("tutorials.dependencies2.addDone"),
      check: {
        kind: "prop",
        edge: ["api", "config"],
        prop: ["settings", { where: { key: setting } }, "key"],
        op: "=",
        value: setting,
      },
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
      check: {
        kind: "prop",
        edge: ["api", "config"],
        prop: ["settings", { where: { key: setting } }, "secret"],
        op: "=",
        value: true,
      },
      targets: [{ testId: lockTarget, tip: msg("tutorials.dependencies2.secretGoal") }],
      demo: [
        {
          kind: "patch",
          edge: ["api", "config"],
          patches: [{ op: "set", path: ["settings", { where: { key: setting } }, "secret"], value: true }],
        },
      ],
      solution: [{ click: lockTarget }],
    },
  ],
  finish: { text: msg("tutorials.dependencies2.finish") },
};
