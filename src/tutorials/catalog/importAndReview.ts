import { msg, t } from "../../i18n";
import { stencilSearch } from "./searchValues";
import type { Tutorial } from "../types";

const source = "tutorial-status-compose.yaml";
export const importAndReview: Tutorial = {
  id: "import-and-review",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 4,
  chrome: "app",
  title: msg("tutorials.importAndReview.title"),
  summary: msg("tutorials.importAndReview.summary"),
  start: () => ({ format: "diagrams/v1", title: t("tutorials.importAndReview.title"), nodes: [], edges: [] }),
  subjects: { api: { role: "processor" }, worker: { role: "processor" }, redis: { role: "store" } },
  steps: [
    {
      id: "import",
      title: msg("tutorials.importAndReview.importTitle"),
      goal: msg("tutorials.importAndReview.importGoal"),
      hint: msg("tutorials.importAndReview.importHint"),
      done: msg("tutorials.importAndReview.importDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "import", format: "compose", source },
          { kind: "node", subject: "worker" },
          { kind: "node", subject: "redis" },
        ],
      },
      sticky: true,
      targets: [{ testId: "tutorial-fixture", tip: msg("tutorials.importAndReview.importTitle") }],
      demo: [{ kind: "importFixture" }],
      solution: [{ click: "tutorial-fixture" }, { importFixture: true }],
    },
    {
      id: "report",
      title: msg("tutorials.importAndReview.reportTitle"),
      goal: () => t("tutorials.importAndReview.reportGoal", { report: t("importReport.importReport") }),
      done: msg("tutorials.importAndReview.reportDone"),
      check: { kind: "importReport", source },
      sticky: true,
      targets: [
        {
          testId: "toast-import-details",
          tip: () => t("tutorials.importAndReview.reportTip", { report: t("importReport.importReport") }),
        },
      ],
      demo: [],
      solution: [
        { press: "ControlOrMeta+k" },
        { fill: "command-input", text: msg("importReport.importReport") },
        { press: "Enter" },
      ],
    },
    {
      id: "read",
      title: msg("tutorials.importAndReview.readTitle"),
      goal: msg("tutorials.importAndReview.readGoal"),
      done: msg("tutorials.importAndReview.readDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "import-report", tip: msg("tutorials.importAndReview.readTitle") }],
      demo: [],
      solution: [{ click: "import-report-done" }, { click: "tutorial-skip" }],
    },
    {
      id: "correct",
      title: msg("tutorials.importAndReview.correctTitle"),
      goal: () =>
        t("tutorials.importAndReview.correctGoal", {
          stencil: stencilSearch("service.python")(),
          name: t("tutorials.importAndReview.workerName"),
        }),
      hint: msg("tutorials.importAndReview.correctHint"),
      done: msg("tutorials.importAndReview.correctDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "stencil", subject: "worker", is: "service.python" },
          { kind: "label", subject: "worker", is: msg("tutorials.importAndReview.workerName") },
          { kind: "edge", from: "worker", to: "redis" },
        ],
      },
      settle: "naming",
      targets: [{ testId: "node-{worker}", tip: msg("tutorials.importAndReview.correctTitle") }],
      demo: [
        { kind: "stencil", subject: "worker", stencil: "service.python" },
        { kind: "rename", subject: "worker", label: msg("tutorials.importAndReview.workerName") },
      ],
      solution: [
        { dblclick: "node-{worker}" },
        { click: "inspector-field-stencil" },
        { fill: "stencil-picker-search", text: stencilSearch("service.python") },
        { press: "Enter" },
        { dblclick: "node-{worker}" },
        { fill: "inspector-field-label", text: msg("tutorials.importAndReview.workerName") },
        { press: "Enter" },
      ],
    },
    {
      id: "privacy",
      title: msg("tutorials.importAndReview.privacyTitle"),
      goal: () =>
        t("tutorials.importAndReview.privacyGoal", {
          report: t("importReport.importReport"),
          name: t("tutorials.importAndReview.workerName"),
        }),
      done: msg("tutorials.importAndReview.privacyDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "importReport", source },
          { kind: "stencil", subject: "worker", is: "service.python" },
        ],
      },
      sticky: true,
      targets: [
        {
          testId: "import-report-privacy",
          tip: () => t("tutorials.importAndReview.reportTip", { report: t("importReport.importReport") }),
        },
      ],
      demo: [],
      solution: [
        { press: "ControlOrMeta+k" },
        { fill: "command-input", text: msg("importReport.importReport") },
        { press: "Enter" },
      ],
    },
    {
      id: "confirm",
      title: msg("tutorials.importAndReview.confirmTitle"),
      goal: msg("tutorials.importAndReview.confirmGoal"),
      done: msg("tutorials.importAndReview.confirmDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "import-report-privacy", tip: msg("tutorials.importAndReview.confirmTitle") }],
      demo: [],
      solution: [{ click: "import-report-done" }, { click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.importAndReview.finish") },
};
