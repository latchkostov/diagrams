import { msg } from "../../i18n";
import example from "../../examples/cache-stampede.json";
import { familyOf } from "../../stencils/profileFamilies";
import type { CacheTable } from "../../model/caching";
import type { DiagramFile } from "../../model/types";
import type { Demo, Tutorial } from "../types";
import { cacheRuleStoringCheck, cachingSubjects, repairCacheRule, rulePath } from "./cachingSteps";
import { runStep } from "./waitingSteps";
import { herdThreshold } from "../../live/cacheHerd";

// Public example expectation identifiers, independent of their displayed labels.
const outcomes = { fetches: "fetches", backlog: "backlog", latency: "latency" };
const cache = example.nodes.find((n) => familyOf(n.stencil) === "edge")!.props.cache as CacheTable;
/**
 * The public example's same-seed expiry comparison, each run cut to 20 s. The example plays 40 s to show the herd
 * escalating; the lesson needs only the herd (it forms within 4 s on every seed) and the replay's end-of-run chips,
 * which settle the same way by 20 s. The replay is read at its end, so this is also how long it plays.
 * Not shorter: the trouble callout offers One fetch per item for about 1.5 s after each 5 s expiry (5.5, 10.7 and
 * 16.3 s on seed 7). A 15 s run can end between those offers, leaving the fix step no action until a restart.
 */
const replayMs = 20000;
const comparison = new Set(["ttl-only", "one-fetch", "serve-stale"]);
function practice(): DiagramFile {
  const d = structuredClone(example) as DiagramFile;
  d.simulations = d.simulations?.map((sim) =>
    comparison.has(sim.id)
      ? {
          ...sim,
          durationMs: replayMs,
          traffic: sim.traffic.map((t) =>
            t.shape.kind === "constant" ? { ...t, shape: { ...t.shape, durationMs: replayMs } } : t,
          ),
        }
      : sim,
  );
  return d;
}
const oneFetch: Demo = {
  kind: "patch",
  subject: "edge",
  patches: [
    ...cache.rules.flatMap((rule) => repairCacheRule(rule, "Shoppers")),
    { op: "set", path: rulePath("keys", "launch"), value: 1 },
    { op: "set", path: rulePath("coalesce", "launch"), value: true },
  ],
  runs: ["ttl-only"],
};

export const cacheStampede: Tutorial = {
  id: "cache-stampede",
  version: 1,
  track: "resilience",
  level: 3,
  minutes: 5,
  title: msg("tutorials.cacheStampede.title"),
  summary: msg("tutorials.cacheStampede.summary"),
  start: practice,
  subjects: cachingSubjects,
  steps: [
    runStep(
      "ttl-only",
      "ttl-only",
      {
        title: msg("tutorials.cacheStampede.runTitle"),
        goal: msg("tutorials.cacheStampede.runGoal"),
        done: msg("tutorials.cacheStampede.runDone"),
      },
      true,
    ),
    {
      id: "herd",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.cacheStampede.herdTitle"),
      goal: msg("tutorials.cacheStampede.herdGoal"),
      done: msg("tutorials.cacheStampede.herdDone"),
      sticky: true,
      check: { kind: "metric", subject: "edge", field: "cache.itemFetches", op: ">=", value: herdThreshold(1) },
      targets: [
        { testId: "call-pill-{edge->origin}", tip: msg("tutorials.cacheStampede.herdTitle") },
        { testId: "node-cache-{edge}", tip: msg("tutorials.cacheStampede.herdTitle") },
      ],
      demo: [],
      solution: [{ hover: "node-{edge}" }],
    },
    {
      id: "one-fetch",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.cacheStampede.fixTitle"),
      goal: msg("tutorials.cacheStampede.fixGoal"),
      done: msg("tutorials.cacheStampede.fixDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          ...cache.rules.map((rule) => cacheRuleStoringCheck(rule, "Shoppers")),
          {
            kind: "prop",
            subject: "edge",
            prop: rulePath("coalesce", "launch"),
            effective: true,
            op: "=",
            value: true,
          },
        ],
      },
      targets: [
        { testId: "trouble-action", tip: msg("tutorials.cacheStampede.fixTitle") },
        { testId: "node-cache-{edge}", tip: msg("tutorials.cacheStampede.herdTitle") },
      ],
      demo: [oneFetch],
      solution: [{ click: "trouble-action" }],
    },
    {
      id: "replay",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.cacheStampede.replayTitle"),
      goal: msg("tutorials.cacheStampede.replayGoal"),
      done: msg("tutorials.cacheStampede.replayDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "simulation", id: "ttl-only", atLeastMs: replayMs },
          { kind: "expectation", simulation: "ttl-only", label: outcomes.fetches, outcome: "pass" },
          { kind: "expectation", simulation: "ttl-only", label: outcomes.backlog, outcome: "pass" },
          { kind: "expectation", simulation: "ttl-only", label: outcomes.latency, outcome: "pass" },
        ],
      },
      targets: [
        { testId: "live-restart", tip: msg("tutorials.cacheStampede.replayTitle") },
        { testId: "live-timeline", tip: msg("tutorials.cacheStampede.replayTitle") },
      ],
      demo: [oneFetch, { kind: "runSimulation", id: "ttl-only" }],
      solution: [{ select: "live-speed", value: "4" }, { click: "live-restart" }, { playing: true }],
    },
  ],
  finish: {
    text: msg("tutorials.cacheStampede.finish"),
    example: { slug: "cache-stampede", label: msg("tutorials.caching.example") },
  },
};
