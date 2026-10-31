import { msg, t } from "../../i18n";
import { experimentDefinition, experimentPractice } from "../../lab/simulationPractice";
import type { SimulationMatch, Tutorial } from "../types";
export const authorASimulation: Tutorial = {
  id: "author-a-simulation",
  version: 1,
  track: "simulation",
  level: 2,
  minutes: 5,
  title: msg("tutorials.authorASimulation.title"),
  summary: msg("tutorials.authorASimulation.summary"),
  start: experimentPractice,
  subjects: {
    client: { stencils: ["client.mobile"] },
    queue: { stencils: ["generic.queue"] },
    worker: { stencils: ["service.python"] },
  },
  steps: [
    {
      id: "burst",
      title: msg("tutorials.authorASimulation.burstTitle"),
      goal: () =>
        t("tutorials.authorASimulation.burstGoal", {
          client: t("tutorials.authorASimulation.client"),
          run: t("tutorials.authorASimulation.runName"),
        }),
      done: msg("tutorials.authorASimulation.burstDone"),
      check: { kind: "draftSimulation", match: match() },
      sticky: true,
      targets: [{ testId: "live-more", tip: msg("tutorials.authorASimulation.burstTitle") }],
      demo: [{ kind: "live" }, { kind: "draftSimulation", simulation: experimentDefinition() }],
      solution: [
        { click: "live-toggle" },
        { click: "live-more" },
        { click: "live-edit-sims" },
        { click: "sim-panel-new" },
        { fill: "sim-panel-title", text: msg("tutorials.authorASimulation.runName") },
        { click: "sim-panel-add-traffic" },
        { fill: "sim-panel-traffic-0-count", text: "10" },
        { fill: "sim-panel-traffic-0-spread", text: "1" },
        { click: "sim-panel-section-details" },
        { fill: "sim-panel-duration", text: "4" },
        { click: "sim-panel-run" },
      ],
    },
    {
      id: "note",
      title: msg("tutorials.authorASimulation.noteTitle"),
      goal: () => t("tutorials.authorASimulation.noteGoal", { worker: t("tutorials.authorASimulation.worker") }),
      done: msg("tutorials.authorASimulation.noteDone"),
      check: { kind: "draftSimulation", match: match(true) },
      sticky: true,
      targets: [{ testId: "live-more", tip: msg("tutorials.authorASimulation.noteTitle") }],
      demo: [{ kind: "draftSimulation", simulation: experimentDefinition(true) }],
      solution: [
        { close: "sim-panel-close" },
        { click: "live-more" },
        { click: "live-edit-sims" },
        { click: "sim-panel-section-timeline" },
        { select: "sim-panel-add-step", value: "note" },
        { fill: "sim-panel-step-0-time", text: "0.5" },
        { fill: "sim-panel-step-0-text", text: msg("tutorials.authorASimulation.noteText") },
        { select: "sim-panel-step-0-focus", value: "worker" },
        { click: "sim-panel-step-0-pause" },
        { click: "sim-panel-run" },
      ],
    },
    {
      id: "save",
      title: msg("tutorials.authorASimulation.saveTitle"),
      goal: () => t("tutorials.authorASimulation.saveGoal", { worker: t("tutorials.authorASimulation.worker") }),
      done: msg("tutorials.authorASimulation.saveDone"),
      check: { kind: "savedSimulation", match: match(true, true) },
      targets: [{ testId: "live-more", tip: msg("tutorials.authorASimulation.saveTitle") }],
      demo: [
        {
          kind: "saveSimulation",
          id: "simulation",
          title: msg("tutorials.authorASimulation.runName"),
          definition: experimentDefinition(true, true),
        },
      ],
      solution: [
        { close: "sim-panel-close" },
        { click: "live-more" },
        { click: "live-edit-sims" },
        { click: "sim-panel-section-expectations" },
        { click: "sim-panel-add-expectation" },
        { fill: "sim-panel-expectation-0-label", text: msg("tutorials.authorASimulation.expectationText") },
        { fill: "sim-panel-expectation-0-value", text: "10" },
        { click: "sim-panel-save" },
      ],
    },
    {
      id: "pause",
      title: msg("tutorials.authorASimulation.pauseTitle"),
      goal: () => t("tutorials.authorASimulation.pauseGoal", { run: t("tutorials.authorASimulation.runName") }),
      done: msg("tutorials.authorASimulation.pauseDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "simulation", saved: match(true, true) },
          { kind: "note", waiting: true },
          { kind: "liveView", view: "simulations", open: false },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.authorASimulation.pauseTitle") }],
      demo: [
        { kind: "openView", view: "simulations", open: false },
        { kind: "runSimulation", id: "simulation" },
      ],
      solution: [{ close: "sim-panel-close" }, { select: "live-sim-picker", value: "simulation" }],
    },
    {
      id: "continue",
      title: msg("tutorials.authorASimulation.continueTitle"),
      goal: msg("tutorials.authorASimulation.continueGoal"),
      done: msg("tutorials.authorASimulation.continueDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "simulation", atLeastMs: 500 },
          { kind: "note", waiting: false, currentOnly: true },
          { kind: "liveView", view: "simulations", open: false },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.authorASimulation.continueTitle") }],
      demo: [
        { kind: "openView", view: "simulations", open: false },
        { kind: "continueNote", simulation: "simulation", atLeastMs: 500 },
      ],
      solution: [{ close: "sim-panel-close" }, { click: "live-note-continue" }],
    },
    {
      id: "result",
      title: msg("tutorials.authorASimulation.resultTitle"),
      goal: () => t("tutorials.authorASimulation.resultGoal", { worker: t("tutorials.authorASimulation.worker") }),
      done: msg("tutorials.authorASimulation.resultDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", saved: match(true, true) },
          { kind: "expectation", simulation: "simulation", match: expectation(), outcome: "pass" },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-speed", tip: msg("tutorials.authorASimulation.resultTitle") }],
      demo: [],
      solution: [{ select: "live-speed", value: "8" }],
    },
    {
      id: "replay",
      title: msg("tutorials.authorASimulation.replayTitle"),
      goal: msg("tutorials.authorASimulation.replayGoal"),
      done: msg("tutorials.authorASimulation.replayDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "simulation", saved: match(true, true) },
          { kind: "note", waiting: false, currentOnly: true },
          { kind: "savedSimulation", match: match(true, true) },
          { kind: "expectation", simulation: "simulation", match: expectation(), outcome: "pass" },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-restart", tip: msg("tutorials.authorASimulation.replayTitle") }],
      demo: [
        { kind: "runSimulation", id: "simulation" },
        { kind: "continueNote", simulation: "simulation", atLeastMs: 500 },
      ],
      solution: [{ click: "live-restart" }, { playing: true }, { click: "live-note-continue" }],
    },
  ],
  finish: { text: msg("tutorials.authorASimulation.finish") },
};

function match(note = false, withExpectation = false): SimulationMatch {
  return {
    id: "simulation",
    traffic: experimentDefinition().traffic,
    seed: 7,
    scale: 1,
    durationMs: 4000,
    multipliers: { traffic: 1, capacity: 1 },
    ...(note ? { note: { focus: "worker", pause: true, atMs: 500 } } : {}),
    ...(withExpectation ? { expectation: expectation() } : {}),
  };
}

function expectation(): NonNullable<SimulationMatch["expectation"]> {
  return { metric: { node: "worker", field: "processed" }, op: ">=", value: 10, when: "end" };
}
