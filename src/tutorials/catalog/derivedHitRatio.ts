import { msg } from "../../i18n";
import { cachingPractice } from "../../lab/cachingPractice";
import type { Tutorial } from "../types";
import { cacheEdit, cacheProperties, cachingSubjects, rulePath, storingCheck, storingRule } from "./cachingSteps";
import { runStep } from "./waitingSteps";

export const derivedHitRatio: Tutorial = {
  id: "derived-hit-ratio",
  version: 1,
  track: "simulation",
  level: 2,
  minutes: 4,
  title: msg("tutorials.derivedHitRatio.title"),
  summary: msg("tutorials.derivedHitRatio.summary"),
  start: cachingPractice,
  subjects: cachingSubjects,
  steps: [
    {
      id: "predict",
      hint: msg("tutorials.derivedHitRatio.predictDone"),
      title: msg("tutorials.derivedHitRatio.predictTitle"),
      goal: msg("tutorials.derivedHitRatio.predictGoal"),
      done: msg("tutorials.derivedHitRatio.predictDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{edge}", tip: msg("tutorials.derivedHitRatio.predictTitle") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
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
      id: "less-traffic",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.derivedHitRatio.trafficTitle"),
      goal: msg("tutorials.derivedHitRatio.trafficGoal"),
      done: msg("tutorials.derivedHitRatio.trafficDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "liveView", view: "inputs", open: true },
          { kind: "inputs", input: "traffic", op: "=", value: 0.2 },
        ],
      },
      targets: [
        { testId: "capacity-traffic-mult", tip: msg("tutorials.derivedHitRatio.trafficTitle") },
        { testId: "live-capacity", tip: msg("tutorials.derivedHitRatio.openInputs") },
      ],
      demo: [
        { kind: "openView", view: "inputs" },
        { kind: "inputs", input: "traffic", value: 0.2 },
      ],
      solution: [
        { click: "live-capacity" },
        { click: "capacity-traffic-mult" },
        { press: "Home" },
        { press: "ArrowRight" },
        { press: "ArrowRight" },
      ],
    },
    cacheEdit(
      "longer-ttl",
      {
        title: msg("tutorials.derivedHitRatio.ttlTitle"),
        goal: msg("tutorials.derivedHitRatio.ttlGoal"),
        done: msg("tutorials.derivedHitRatio.ttlDone"),
      },
      {
        kind: "all",
        checks: [
          storingCheck(),
          { kind: "prop", subject: "edge", prop: rulePath("ttlMs"), effective: true, op: "=", value: 60000 },
          { kind: "inputs", input: "traffic", op: "=", value: 0.2 },
        ],
      },
      [
        {
          kind: "patch",
          subject: "edge",
          patches: [
            ...storingRule({ ttlMs: 1000, keys: 20, popularity: "even" }),
            { op: "set", path: rulePath("ttlMs"), value: 60000 },
          ],
          runs: ["cache-traffic"],
        },
        { kind: "inputs", input: "traffic", value: 0.2 },
      ],
      "cache-rule-products-ttl-60000",
      [
        { close: "capacity-close" },
        ...cacheProperties,
        { click: "cache-rule-products" },
        { click: "cache-rule-products-ttl-60000" },
      ],
      "products",
      [
        { close: "capacity-close" },
        { focus: "node-{edge}" },
        { press: "F2" },
        { open: "dock-edit-properties" },
        { open: "inspector-section-node-cache" },
        { activate: "cache-rule-products" },
        { focus: "cache-rule-products-ttl-custom" },
        { press: "ArrowRight" },
        { press: "ArrowRight" },
      ],
    ),
    {
      id: "explanation",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.derivedHitRatio.explainTitle"),
      goal: msg("tutorials.derivedHitRatio.explainGoal"),
      done: msg("tutorials.derivedHitRatio.explainDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [
        { testId: "cache-derivation-{edge}-products", tip: msg("tutorials.derivedHitRatio.explainTitle") },
        { testId: "live-capacity", tip: msg("tutorials.derivedHitRatio.openInputs") },
      ],
      demo: [],
      solution: [{ click: "live-capacity" }, { click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.derivedHitRatio.finish") },
};
