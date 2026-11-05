import { msg } from "../../i18n";
import { cachingPractice } from "../../lab/cachingPractice";
import type { Tutorial } from "../types";
import { cachingSubjects } from "./cachingSteps";
import { runStep } from "./waitingSteps";

export const cdnCache: Tutorial = {
  id: "cdn-cache",
  version: 1,
  track: "blocks",
  level: 2,
  minutes: 4,
  title: msg("tutorials.cdnCache.title"),
  summary: msg("tutorials.cdnCache.summary"),
  start: () => cachingPractice(false),
  subjects: cachingSubjects,
  steps: [
    {
      id: "what-is-a-cache",
      hint: msg("tutorials.cdnCache.introDone"),
      title: msg("tutorials.cdnCache.introTitle"),
      goal: msg("tutorials.cdnCache.introGoal"),
      done: msg("tutorials.cdnCache.introDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{edge}", tip: msg("tutorials.cdnCache.introTitle") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
    {
      id: "rule",
      hint: msg("tutorials.caching.menuHint"),
      title: msg("tutorials.cdnCache.ruleTitle"),
      goal: msg("tutorials.cdnCache.ruleGoal"),
      done: msg("tutorials.cdnCache.ruleDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          {
            kind: "prop",
            subject: "edge",
            prop: [
              "cache",
              "rules",
              { where: { match: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } } } },
              "policy",
              "ttlMs",
            ],
            op: ">=",
            value: 1000,
          },
        ],
      },
      targets: [
        { testId: "context-menu-item-node.add-cache-rules", tip: msg("tutorials.cdnCache.ruleTitle") },
        { testId: "cache-add", tip: msg("tutorials.cdnCache.ruleTitle") },
        { testId: "node-{edge}", tip: msg("tutorials.cdnCache.ruleTitle") },
      ],
      demo: [
        {
          kind: "patch",
          subject: "edge",
          patches: [
            {
              op: "ensureItem",
              uniqueId: true,
              path: ["cache", "rules"],
              match: { match: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } } },
              with: { id: "products", policy: { ttlMs: 300000, keys: 50000, popularity: "typical" } },
            },
            {
              op: "unset",
              path: [
                "cache",
                "rules",
                { where: { match: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } } } },
                "policy",
                "noStore",
              ],
            },
            {
              op: "setIfMissing",
              path: [
                "cache",
                "rules",
                { where: { match: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } } } },
                "policy",
                "ttlMs",
              ],
              value: 300000,
            },
            {
              op: "atLeast",
              path: [
                "cache",
                "rules",
                { where: { match: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } } } },
                "policy",
                "ttlMs",
              ],
              value: 300000,
            },
          ],
        },
      ],
      solution: [
        { rightclick: "node-{edge}" },
        { hover: "context-menu-item-node.simulation" },
        { click: "context-menu-item-node.add-cache-rules" },
      ],
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
      id: "offload",
      hint: msg("tutorials.cdnCache.offloadHint"),
      title: msg("tutorials.cdnCache.offloadTitle"),
      goal: msg("tutorials.cdnCache.offloadGoal"),
      done: msg("tutorials.cdnCache.offloadDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "compare", left: { sinceStep: { node: "edge", metric: "processed" } }, op: ">=", right: 100 },
          {
            kind: "compare",
            left: { sinceStep: { node: "origin", metric: "processed" } },
            op: "<",
            right: { sinceStep: { node: "edge", metric: "processed" } },
          },
          { kind: "compare", left: { sinceStep: { node: "edge", metric: "cache.hitRatio" } }, op: ">=", right: 50 },
        ],
      },
      targets: [
        { testId: "node-cache-{edge}", tip: msg("tutorials.cdnCache.offloadTitle") },
        { testId: "node-{edge}", tip: msg("tutorials.cdnCache.offloadTitle") },
      ],
      demo: [],
      solution: [{ hover: "node-{edge}" }],
    },
  ],
  finish: {
    text: msg("tutorials.cdnCache.finish"),
    example: { slug: "cache-stampede", label: msg("tutorials.caching.example") },
  },
};
