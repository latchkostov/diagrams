import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { liveStep, practiceRun } from "./buildingBlocks";

export const authorADrill: Tutorial = {
  id: "author-a-drill",
  version: 1,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.authorADrill.title"),
  summary: msg("tutorials.authorADrill.summary"),
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
      targets: [{ testId: "live-edit-sims", tip: msg("tutorials.authorADrill.openGoal") }],
      demo: [{ kind: "openView", view: "simulations" }],
      solution: [{ click: "live-more" }, { click: "live-edit-sims" }],
    },
    {
      id: "save",
      title: msg("tutorials.authorADrill.saveTitle"),
      goal: msg("tutorials.authorADrill.saveGoal"),
      done: msg("tutorials.authorADrill.saveDone"),
      check: { kind: "savedSimulation", match: { drill: "slow-dependency" } },
      targets: [{ testId: "sim-panel-new", tip: msg("tutorials.authorADrill.saveGoal") }],
      demo: [
        {
          kind: "saveSimulation",
          id: "simulation",
          title: msg("tutorials.authorADrill.drillName"),
          drills: [{ preset: "slow-dependency", atMs: 0 }],
        },
      ],
      solution: [
        { click: "sim-panel-new" },
        { click: "sim-panel-section-timeline" },
        { select: "sim-panel-add-step", value: "slow-dependency" },
        { click: "sim-panel-save" },
      ],
    },
    {
      id: "run",
      title: msg("tutorials.authorADrill.runTitle"),
      goal: msg("tutorials.authorADrill.runGoal"),
      done: msg("tutorials.authorADrill.runDone"),
      check: { kind: "simulation", saved: { drill: "slow-dependency" } },
      targets: [{ testId: "sim-panel-run", tip: msg("tutorials.authorADrill.runGoal") }],
      demo: [
        // A learner may have saved a different id. Skip keeps it and ensures a runnable reference Drill.
        {
          kind: "saveSimulation",
          id: "simulation",
          title: msg("tutorials.authorADrill.drillName"),
          drills: [{ preset: "slow-dependency", atMs: 0 }],
        },
        { kind: "runSimulation", id: "simulation" },
      ],
      solution: [{ click: "sim-panel-run" }],
    },
  ],
  finish: { text: msg("tutorials.authorADrill.finish") },
};
