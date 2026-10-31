import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { liveStep, practiceRun } from "./buildingBlocks";

export const authorADrill: Tutorial = {
  id: "author-a-drill",
  version: 2,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.authorADrill.title"),
  summary: msg("tutorials.authorADrill.summaryV2"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.authorADrill.title"),
    nodes: [
      {
        id: "client",
        stencil: "client.mobile",
        label: t("tutorials.authorADrill.clientName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 2 },
      },
      { id: "service", stencil: "generic.service", label: t("tutorials.authorADrill.serviceName"), x: 280, y: 0 },
      { id: "db", stencil: "postgres", label: t("tutorials.authorADrill.dbName"), x: 560, y: 0 },
    ],
    edges: [
      { id: "request", from: "client", to: "service", kind: "sync" },
      { id: "query", from: "service", to: "db", kind: "sync" },
    ],
    simulations: [practiceRun(msg("tutorials.authorADrill.runName"))],
  }),
  subjects: {
    client: { stencils: ["client.mobile"] },
    service: { stencils: ["generic.service"] },
    db: { stencils: ["postgres"] },
  },
  steps: [
    {
      ...liveStep(
        msg("tutorials.authorADrill.liveTitle"),
        msg("tutorials.authorADrill.liveGoal"),
        msg("tutorials.authorADrill.liveDone"),
      ),
      // Starting practice traffic is a moment: the final step deliberately switches to the learner's Drill.
      sticky: true,
    },
    {
      id: "open",
      title: msg("tutorials.authorADrill.openTitle"),
      goal: msg("tutorials.authorADrill.openGoal"),
      done: msg("tutorials.authorADrill.openDone"),
      check: { kind: "liveView", view: "simulations", open: true },
      // Opening the editor is a moment: Run closes it before choosing the saved Drill.
      sticky: true,
      targets: [{ testId: "live-edit-sims", tip: msg("tutorials.authorADrill.openGoal") }],
      demo: [{ kind: "openView", view: "simulations" }],
      solution: [{ click: "live-more" }, { click: "live-edit-sims" }],
    },
    {
      id: "save",
      title: msg("tutorials.authorADrill.saveTitle"),
      goal: () => t("tutorials.authorADrill.saveGoalV2", { db: t("tutorials.authorADrill.dbName") }),
      done: () => t("tutorials.authorADrill.saveDoneV2", { db: t("tutorials.authorADrill.dbName") }),
      check: {
        kind: "savedSimulation",
        match: { drill: "slow-dependency", fault: { node: "db", atMs: 0, kind: "slow" } },
      },
      targets: [
        {
          testId: "sim-panel-new",
          tip: () => t("tutorials.authorADrill.saveGoalV2", { db: t("tutorials.authorADrill.dbName") }),
        },
      ],
      demo: [
        {
          kind: "saveSimulation",
          id: "simulation",
          title: msg("tutorials.authorADrill.drillName"),
          durationMs: 600_000,
          drills: [{ preset: "slow-dependency", atMs: 0, target: "db" }],
        },
      ],
      solution: [
        { click: "sim-panel-back" },
        { click: "sim-panel-new" },
        { click: "sim-panel-section-timeline" },
        { select: "sim-panel-add-step", value: "slow-dependency" },
        { select: "sim-panel-step-0-fault-target", value: "db" },
        { click: "sim-panel-section-details" },
        { fill: "sim-panel-duration", text: "600" },
        { click: "sim-panel-save" },
      ],
    },
    {
      id: "run",
      title: msg("tutorials.authorADrill.runTitle"),
      goal: () => t("tutorials.authorADrill.runGoalV2", { db: t("tutorials.authorADrill.dbName") }),
      done: () => t("tutorials.authorADrill.runDoneV2", { db: t("tutorials.authorADrill.dbName") }),
      check: {
        kind: "all",
        checks: [
          {
            kind: "simulation",
            saved: { drill: "slow-dependency", fault: { node: "db", atMs: 0, kind: "slow" } },
            traffic: true,
          },
          { kind: "fault", subject: "db", fault: "slow" },
          { kind: "processed", subject: "db", atLeast: 1 },
        ],
      },
      targets: [
        {
          testId: "sim-panel-close",
          tip: () => t("tutorials.authorADrill.runGoalV2", { db: t("tutorials.authorADrill.dbName") }),
        },
        {
          testId: "live-sim-picker",
          tip: () => t("tutorials.authorADrill.runGoalV2", { db: t("tutorials.authorADrill.dbName") }),
        },
      ],
      demo: [
        // A learner may have saved a different id. Skip keeps it and ensures a runnable reference Drill.
        {
          kind: "saveSimulation",
          id: "simulation",
          title: msg("tutorials.authorADrill.drillName"),
          durationMs: 600_000,
          drills: [{ preset: "slow-dependency", atMs: 0, target: "db" }],
        },
        { kind: "runSimulation", id: "simulation" },
        { kind: "traffic", on: true },
      ],
      solution: [
        { click: "sim-panel-close" },
        { select: "live-sim-picker", value: "simulation" },
        { click: "live-more" },
        { click: "live-traffic" },
      ],
      keyboardSolution: [
        { press: "Escape" },
        { choose: "live-sim-picker", value: "simulation" },
        { activate: "live-more" },
        { activate: "live-traffic" },
      ],
    },
  ],
  finish: { text: () => t("tutorials.authorADrill.finishV2", { db: t("tutorials.authorADrill.dbName") }) },
};
