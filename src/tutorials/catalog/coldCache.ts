import { msg } from "../../i18n";
import { coldCachePractice } from "../../lab/cachingPractice";
import { familyOf } from "../../stencils/profileFamilies";
import type { CacheTable } from "../../model/caching";
import type { Demo, SimulationMatch, Tutorial } from "../types";
import { cachingSubjects, repairCacheRule } from "./cachingSteps";
import { runStep } from "./waitingSteps";

const match = (mode: "hard" | "soft"): SimulationMatch => ({
  drill: "cold-cache",
  fault: { node: "edge", kind: "purge", mode, atMs: 0, allRules: true },
});
const save = (mode: "hard" | "soft"): Demo => ({
  kind: "saveSimulation",
  id: "simulation",
  title: msg("tutorials.coldCache.drillName"),
  durationMs: 10000,
  drills: [{ preset: "cold-cache", target: "edge", atMs: 0, mode }],
});
// Authoring a purge cannot rescue a rule the learner removed or set to Don't store.
const cache = coldCachePractice().nodes.find((n) => familyOf(n.stencil) === "edge")!.props!.cache as CacheTable;
const restoreCache: Demo = {
  kind: "patch",
  subject: "edge",
  patches: cache.rules.flatMap((rule) => repairCacheRule(rule, "Shoppers")),
  runs: ["serve-stale", "simulation", { selected: true }],
};

export const coldCache: Tutorial = {
  id: "cold-cache",
  version: 1,
  track: "resilience",
  level: 3,
  minutes: 5,
  title: msg("tutorials.coldCache.title"),
  summary: msg("tutorials.coldCache.summary"),
  start: coldCachePractice,
  subjects: cachingSubjects,
  steps: [
    runStep(
      "live",
      "serve-stale",
      {
        title: msg("tutorials.caching.runTitle"),
        goal: msg("tutorials.coldCache.liveGoal"),
        done: msg("tutorials.coldCache.liveDone"),
      },
      true,
    ),
    {
      id: "author",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.coldCache.authorTitle"),
      goal: msg("tutorials.coldCache.authorGoal"),
      done: msg("tutorials.coldCache.authorDone"),
      sticky: true,
      check: { kind: "savedSimulation", match: { ...match("hard"), durationMs: 10000 } },
      targets: [
        { testId: "sim-panel-duration", priority: "field", tip: msg("tutorials.coldCache.authorTitle") },
        { testId: "sim-panel-step-0-fault-target", priority: "field", tip: msg("tutorials.coldCache.authorTitle") },
        { testId: "sim-panel-step-0-time", priority: "field", tip: msg("tutorials.coldCache.authorTitle") },
        { testId: "sim-panel-save", tip: msg("tutorials.coldCache.authorTitle") },
        { testId: "sim-panel-add-step", tip: msg("tutorials.coldCache.authorTitle") },
        { testId: "sim-panel-new", tip: msg("tutorials.coldCache.authorTitle") },
        { testId: "live-edit-sims", tip: msg("tutorials.coldCache.openEditor") },
        { testId: "context-menu-item-sim.purge", tip: msg("tutorials.coldCache.faultTip") },
        { testId: "live-more", tip: msg("tutorials.coldCache.openEditor") },
      ],
      demo: [save("hard"), restoreCache],
      solution: [
        { click: "live-more" },
        { click: "live-edit-sims" },
        { click: "sim-panel-back" },
        { click: "sim-panel-new" },
        { click: "sim-panel-section-timeline" },
        { select: "sim-panel-add-step", value: "cold-cache" },
        { select: "sim-panel-step-0-fault-target", value: "{edge}" },
        { fill: "sim-panel-step-0-time", text: "0" },
        { click: "sim-panel-section-details" },
        { fill: "sim-panel-duration", text: "10" },
        { click: "sim-panel-save" },
      ],
    },
    {
      id: "surge",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.coldCache.surgeTitle"),
      goal: msg("tutorials.coldCache.surgeGoal"),
      done: msg("tutorials.coldCache.surgeDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", saved: match("hard"), traffic: true },
          { kind: "liveView", view: "simulations", open: false },
          { kind: "compare", left: { node: "origin", metric: "backlog" }, op: ">=", right: 50 },
        ],
      },
      targets: [
        { testId: "node-{origin}", tip: msg("tutorials.coldCache.surgeTitle") },
        { testId: "live-sim-picker", tip: msg("tutorials.coldCache.surgeTitle") },
      ],
      demo: [
        save("hard"),
        restoreCache,
        { kind: "openView", view: "simulations", open: false },
        { kind: "runSimulation", id: "simulation" },
        { kind: "traffic", on: true },
      ],
      solution: [
        { close: "sim-panel-close" },
        { select: "live-sim-picker", value: "simulation" },
        { click: "live-more" },
        { click: "live-traffic" },
        { press: "Escape" },
        { hover: "node-{origin}" },
      ],
    },
    {
      id: "soft-purge",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.coldCache.softTitle"),
      goal: msg("tutorials.coldCache.softGoal"),
      done: msg("tutorials.coldCache.softDone"),
      check: { kind: "savedSimulation", match: match("soft") },
      targets: [
        { testId: "sim-panel-step-0-fault-value", tip: msg("tutorials.coldCache.softTitle") },
        { testId: "context-menu-item-sim.soft-purge", tip: msg("tutorials.coldCache.faultTip") },
        { testId: "live-more", tip: msg("tutorials.coldCache.openEditor") },
      ],
      demo: [save("soft"), restoreCache],
      solution: [
        { click: "live-more" },
        { click: "live-edit-sims" },
        { open: "sim-panel-section-timeline" },
        { select: "sim-panel-step-0-fault-value", value: "soft" },
        { click: "sim-panel-save" },
      ],
    },
    {
      id: "soft-result",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.coldCache.resultTitle"),
      goal: msg("tutorials.coldCache.resultGoal"),
      done: msg("tutorials.coldCache.resultDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "liveView", view: "simulations", open: false },
          { kind: "simulation", saved: match("soft"), traffic: true, atLeastMs: 9000 },
          { kind: "processed", subject: "edge", atLeast: 1000 },
          { kind: "compare", left: { node: "origin", metric: "backlog" }, op: "<=", right: 49 },
        ],
      },
      targets: [
        { testId: "live-restart", tip: msg("tutorials.coldCache.resultTitle") },
        { testId: "node-{origin}", tip: msg("tutorials.coldCache.resultTitle") },
      ],
      demo: [
        restoreCache,
        { kind: "openView", view: "simulations", open: false },
        { kind: "runSimulation", id: "simulation" },
        { kind: "traffic", on: true },
      ],
      solution: [
        { close: "sim-panel-close" },
        { click: "live-restart" },
        { playing: true },
        { hover: "node-{origin}" },
      ],
    },
  ],
  finish: {
    text: msg("tutorials.coldCache.finish"),
    example: { slug: "cache-stampede", label: msg("tutorials.caching.example") },
  },
};
