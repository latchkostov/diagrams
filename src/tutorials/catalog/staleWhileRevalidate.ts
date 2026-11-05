import { familyOf } from "../../stencils/profileFamilies";
import { msg } from "../../i18n";
import { cachingPractice } from "../../lab/cachingPractice";
import type { CacheTable } from "../../model/caching";
import type { Tutorial } from "../types";
import { cacheEdit, cacheProperties, cachingSubjects, rulePath } from "./cachingSteps";
import { runStep } from "./waitingSteps";

export const staleWhileRevalidate: Tutorial = {
  id: "stale-while-revalidate",
  version: 1,
  track: "resilience",
  level: 3,
  minutes: 4,
  title: msg("tutorials.staleRefresh.title"),
  summary: msg("tutorials.staleRefresh.summary"),
  start: () => {
    const d = cachingPractice();
    const table = d.nodes.find((n) => familyOf(n.stencil) === "edge")!.props!.cache as CacheTable;
    table.rules[0].policy = { ttlMs: 1000, keys: 1, coalesce: true };
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
      id: "expiry",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.staleRefresh.expiryTitle"),
      goal: msg("tutorials.staleRefresh.expiryGoal"),
      done: msg("tutorials.staleRefresh.expiryDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "processed", subject: "edge", atLeast: 600 },
          { kind: "metric", subject: "edge", field: "cache.hitRatio", op: "<=", value: 99 },
          { kind: "readout", subject: "edge" },
        ],
      },
      targets: [{ testId: "node-cache-{edge}", tip: msg("tutorials.staleRefresh.expiryTitle") }],
      demo: [],
      solution: [{ hover: "node-{edge}" }],
    },
    cacheEdit(
      "stale-window",
      {
        title: msg("tutorials.staleRefresh.windowTitle"),
        goal: msg("tutorials.staleRefresh.windowGoal"),
        done: msg("tutorials.staleRefresh.windowDone"),
      },
      {
        kind: "prop",
        subject: "edge",
        prop: rulePath("staleWhileRevalidateMs"),
        effective: true,
        op: ">=",
        value: 10000,
      },
      [
        {
          kind: "patch",
          subject: "edge",
          patches: [
            { op: "setIfMissing", path: rulePath("staleWhileRevalidateMs"), value: 10000 },
            { op: "atLeast", path: rulePath("staleWhileRevalidateMs"), value: 10000 },
          ],
          runs: ["cache-traffic"],
        },
      ],
      "cache-rule-products-stale-window",
      [
        ...cacheProperties,
        { click: "cache-rule-products" },
        { open: "cache-rule-products-expires-toggle" },
        { select: "cache-rule-products-stale-window", value: "10000" },
      ],
    ),
    {
      id: "refresh",
      hint: msg("tutorials.caching.replayHint"),
      title: msg("tutorials.staleRefresh.refreshTitle"),
      goal: msg("tutorials.staleRefresh.refreshGoal"),
      done: msg("tutorials.staleRefresh.refreshDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "processed", subject: "edge", atLeast: 1000 },
          { kind: "metric", subject: "edge", field: "cache.hitRatio", op: ">=", value: 99.9 },
          { kind: "metric", subject: "edge", field: "cache.itemFetches", op: "<=", value: 1 },
        ],
      },
      targets: [
        { testId: "node-cache-{edge}", tip: msg("tutorials.staleRefresh.refreshTitle") },
        { testId: "live-restart", tip: msg("tutorials.staleRefresh.refreshTitle") },
      ],
      demo: [{ kind: "runSimulation", id: "cache-traffic" }],
      solution: [{ click: "live-restart" }, { playing: true }, { hover: "node-{edge}" }],
    },
  ],
  finish: {
    text: msg("tutorials.staleRefresh.finish"),
    example: { slug: "cache-stampede", label: msg("tutorials.caching.example") },
  },
};
