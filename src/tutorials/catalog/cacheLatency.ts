import { familyOf } from "../../stencils/profileFamilies";
import { msg } from "../../i18n";
import { cachingPractice } from "../../lab/cachingPractice";
import type { Demo, Tutorial } from "../types";
import { cacheEdit, cacheProperties, cachingSubjects, ensureCacheRule, rulePath } from "./cachingSteps";
import { productCache } from "../../lab/cachingPractice";
import { runStep } from "./waitingSteps";

const dontStore: Demo = {
  kind: "patch",
  subject: "edge",
  patches: [ensureCacheRule(productCache().rules[0]), { op: "set", path: rulePath(), value: { noStore: true } }],
  runs: ["cache-traffic"],
};

export const cacheLatency: Tutorial = {
  id: "cache-latency",
  version: 1,
  track: "waiting",
  level: 2,
  minutes: 4,
  title: msg("tutorials.cacheLatency.title"),
  summary: msg("tutorials.cacheLatency.summary"),
  start: () => {
    const d = cachingPractice();
    d.nodes.find((n) => familyOf(n.stencil) === "client")!.props!.ratePerSec = 40;
    d.simulations![0].traffic[0].shape = { kind: "constant", ratePerSec: 40, durationMs: 600000 };
    return d;
  },
  subjects: cachingSubjects,
  steps: [
    runStep(
      "live",
      "cache-traffic",
      {
        title: msg("tutorials.caching.runTitle"),
        goal: msg("tutorials.caching.runGoal"),
        done: msg("tutorials.caching.runDone"),
      },
      true,
    ),
    {
      id: "cached-tail",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.cacheLatency.cachedTitle"),
      goal: msg("tutorials.cacheLatency.cachedGoal"),
      done: msg("tutorials.cacheLatency.cachedDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "processed", subject: "edge", atLeast: 200 },
          { kind: "compare", left: { node: "edge", metric: "cache.hitRatio" }, op: ">=", right: 50 },
          { kind: "compare", left: { node: "edge", metric: "cache.hitRatio" }, op: "<", right: 95 },
          { kind: "compare", left: { node: "readers", metric: "latency.p95" }, op: ">=", right: 100 },
          { kind: "readout", subject: "readers" },
        ],
      },
      targets: [{ testId: "node-{readers}", tip: msg("tutorials.cacheLatency.cachedTitle") }],
      demo: [],
      solution: [{ hover: "node-{readers}" }],
    },
    cacheEdit(
      "dont-store",
      {
        title: msg("tutorials.cacheLatency.noStoreTitle"),
        goal: msg("tutorials.cacheLatency.noStoreGoal"),
        done: msg("tutorials.cacheLatency.noStoreDone"),
      },
      { kind: "prop", subject: "edge", prop: rulePath("noStore"), effective: true, op: "=", value: true },
      [dontStore],
      "cache-rule-products-no-store",
      [...cacheProperties, { click: "cache-rule-products" }, { click: "cache-rule-products-no-store" }],
    ),
    {
      id: "restart-uncached",
      title: msg("tutorials.cacheLatency.restartTitle"),
      goal: msg("tutorials.cacheLatency.restartGoal"),
      hint: msg("tutorials.caching.replayHint"),
      done: msg("tutorials.cacheLatency.noStoreDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "simulation", id: "cache-traffic" },
          { kind: "prop", subject: "edge", prop: rulePath("noStore"), effective: true, op: "=", value: true },
        ],
      },
      targets: [{ testId: "live-restart", tip: msg("tutorials.cacheLatency.restartTitle") }],
      demo: [dontStore, { kind: "runSimulation", id: "cache-traffic" }],
      solution: [{ click: "live-restart" }, { playing: true }],
    },
    {
      id: "uncached-tail",
      hint: msg("tutorials.cacheLatency.interpretGoal"),
      title: msg("tutorials.cacheLatency.uncachedTitle"),
      goal: msg("tutorials.cacheLatency.uncachedGoal"),
      done: msg("tutorials.cacheLatency.uncachedDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "readout", subject: "readers" },
          { kind: "processed", subject: "edge", atLeast: 200 },
          { kind: "compare", left: { node: "readers", metric: "latency.p95" }, op: ">=", right: 100 },
          { kind: "metric", subject: "edge", field: "cache.offload", op: "<=", value: 0 },
        ],
      },
      targets: [{ testId: "node-{readers}", tip: msg("tutorials.cacheLatency.uncachedTitle") }],
      demo: [],
      solution: [{ hover: "node-{readers}" }],
    },
    {
      id: "interpret",
      hint: msg("tutorials.cacheLatency.interpretDone"),
      title: msg("tutorials.cacheLatency.interpretTitle"),
      goal: msg("tutorials.cacheLatency.interpretGoal"),
      done: msg("tutorials.cacheLatency.interpretDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-cache-{edge}", tip: msg("tutorials.cacheLatency.interpretTitle") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.cacheLatency.finish") },
};
