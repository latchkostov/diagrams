import { msg } from "../../i18n";
import type { Tutorial } from "../types";
export const dependencies: Tutorial = {
  id: "dependencies",
  version: 1,
  track: "basics",
  level: 2,
  minutes: 3,
  title: msg("tutorials.dependencies.title"),
  summary: msg("tutorials.dependencies.summary"),
  start: { example: "aks-app-config-key-vault" },
  subjects: { svc: { stencils: ["service.dotnet"] }, vault: { stencils: ["azure.key-vault"] } },
  steps: [
    {
      id: "draw",
      title: msg("tutorials.dependencies.drawTitle"),
      goal: msg("tutorials.dependencies.drawGoal"),
      done: msg("tutorials.dependencies.drawDone"),
      check: { kind: "relation", from: "svc", to: "vault", relation: "secret" },
      targets: [{ testId: "handle-{svc}-right", tip: msg("tutorials.dependencies.drawTip") }],
      demo: [
        { kind: "connect", from: "svc", to: "vault" },
        { kind: "relation", from: "svc", to: "vault", relation: "secret" },
      ],
      solution: [{ drag: "handle-{svc}-right", to: "node-{vault}" }],
    },
    {
      id: "hide",
      title: msg("tutorials.dependencies.hideTitle"),
      goal: msg("tutorials.dependencies.hideGoal"),
      done: msg("tutorials.dependencies.hideDone"),
      check: { kind: "dependencies", visible: false },
      targets: [{ testId: "canvas-pane", tip: msg("tutorials.dependencies.hideTip") }],
      demo: [],
      solution: [
        { rightclick: "canvas-pane" },
        { hover: "context-menu-item-canvas.view-options" },
        { click: "context-menu-item-view:dependencies" },
      ],
      sticky: true,
    },
  ],
  finish: { text: msg("tutorials.dependencies.finish") },
};
