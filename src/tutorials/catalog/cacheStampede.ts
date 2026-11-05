import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { cachingSubjects, rulePath } from "./cachingSteps";
import { runStep } from "./waitingSteps";
import { herdThreshold } from "../../live/cacheHerd";

// Public example expectation identifiers, independent of their displayed labels.
const outcomes = { fetches: "fetches", backlog: "backlog", latency: "latency" };

export const cacheStampede: Tutorial = {
  id: "cache-stampede",
  version: 1,
  track: "resilience",
  level: 3,
  minutes: 5,
  title: msg("tutorials.cacheStampede.title"),
  summary: msg("tutorials.cacheStampede.summary"),
  start: { example: "cache-stampede" },
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
        kind: "prop",
        subject: "edge",
        prop: rulePath("coalesce", "launch"),
        effective: true,
        op: "=",
        value: true,
      },
      targets: [
        { testId: "trouble-action", tip: msg("tutorials.cacheStampede.fixTitle") },
        { testId: "node-cache-{edge}", tip: msg("tutorials.cacheStampede.herdTitle") },
      ],
      demo: [
        {
          kind: "patch",
          subject: "edge",
          patches: [{ op: "set", path: rulePath("coalesce", "launch"), value: true }],
          runs: ["ttl-only"],
        },
      ],
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
          { kind: "simulation", id: "ttl-only", atLeastMs: 40000 },
          { kind: "expectation", simulation: "ttl-only", label: outcomes.fetches, outcome: "pass" },
          { kind: "expectation", simulation: "ttl-only", label: outcomes.backlog, outcome: "pass" },
          { kind: "expectation", simulation: "ttl-only", label: outcomes.latency, outcome: "pass" },
        ],
      },
      targets: [
        { testId: "live-restart", tip: msg("tutorials.cacheStampede.replayTitle") },
        { testId: "live-timeline", tip: msg("tutorials.cacheStampede.replayTitle") },
      ],
      demo: [{ kind: "runSimulation", id: "ttl-only" }],
      solution: [{ select: "live-speed", value: "4" }, { click: "live-restart" }, { playing: true }],
    },
  ],
  finish: {
    text: msg("tutorials.cacheStampede.finish"),
    example: { slug: "cache-stampede", label: msg("tutorials.caching.example") },
  },
};
