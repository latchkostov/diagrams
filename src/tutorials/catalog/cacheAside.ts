import { stencilSearch } from "./searchValues";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { connectedStep, liveStep, practiceRun } from "./buildingBlocks";

export const cacheAside: Tutorial = {
  id: "cache-aside",
  version: 2,
  track: "blocks",
  level: 2,
  minutes: 3,
  title: msg("tutorials.cacheAside.title"),
  summary: msg("tutorials.cacheAside.summaryVerified"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.cacheAside.title"),
    nodes: [
      {
        id: "app",
        stencil: "client.mobile",
        label: t("tutorials.cacheAside.appName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 8 },
      },
      { id: "api", stencil: "generic.service", label: t("tutorials.cacheAside.apiName"), x: 240, y: 0 },
      { id: "db", stencil: "postgres", label: t("tutorials.cacheAside.dbName"), x: 480, y: -110 },
    ],
    edges: [
      { id: "app-api", from: "app", to: "api", kind: "sync" },
      { id: "api-db", from: "api", to: "db", kind: "sync" },
    ],
    simulations: [practiceRun(msg("tutorials.cacheAside.runName"))],
  }),
  subjects: {
    app: { stencils: ["client.mobile"] },
    api: { stencils: ["generic.service"] },
    db: { stencils: ["postgres"] },
    redis: { stencils: ["redis.cache"] },
  },
  steps: [
    connectedStep({
      hint: msg("tutorials.cacheAside.addHint"),
      id: "add-redis",
      from: "api",
      subject: "redis",
      stencil: "redis.cache",
      search: stencilSearch("redis.cache"),
      title: msg("tutorials.cacheAside.addRedisTitle"),
      goal: msg("tutorials.cacheAside.addRedisGoal"),
      done: msg("tutorials.cacheAside.addRedisDone"),
    }),
    {
      id: "cache-share",
      title: msg("tutorials.cacheAside.cache-shareTitle"),
      goal: msg("tutorials.cacheAside.cache-shareGoal"),
      done: msg("tutorials.cacheAside.cacheShareDone"),
      check: { kind: "prop", edge: ["api", "redis"], prop: "share", op: "=", value: 0.8 },
      targets: [{ testId: "node-{redis}", tip: msg("tutorials.cacheAside.cache-shareTitle") }],
      demo: [{ kind: "prop", edge: ["api", "redis"], props: { share: 0.8 } }],
      solution: [
        { click: "node-{redis}" },
        { press: "Control+Alt+[" },
        { open: "inspector-section-edge-simulation" },
        { fill: "inspector-field-share", text: "80" },
        { press: "Enter" },
      ],
    },
    {
      id: "database-share",
      title: msg("tutorials.cacheAside.database-shareTitle"),
      goal: () => t("tutorials.cacheAside.database-shareGoal", { database: t("tutorials.cacheAside.dbName") }),
      done: msg("tutorials.cacheAside.databaseShareDone"),
      check: { kind: "prop", edge: ["api", "db"], prop: "share", op: "=", value: 0.2 },
      targets: [{ testId: "node-{db}", tip: msg("tutorials.cacheAside.database-shareTitle") }],
      demo: [{ kind: "prop", edge: ["api", "db"], props: { share: 0.2 } }],
      solution: [
        { click: "node-{db}" },
        { press: "Control+Alt+[" },
        { open: "inspector-section-edge-simulation" },
        { fill: "inspector-field-share", text: "20" },
        { press: "Enter" },
      ],
    },
    liveStep(
      msg("tutorials.cacheAside.liveTitle"),
      msg("tutorials.cacheAside.liveGoal"),
      msg("tutorials.cacheAside.liveDone"),
    ),
    {
      id: "watch",
      title: msg("tutorials.cacheAside.watchTitle"),
      goal: msg("tutorials.cacheAside.watchGoal"),
      done: msg("tutorials.cacheAside.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "tutorial-flow" },
          { kind: "processed", subject: "redis", atLeast: 10 },
          {
            kind: "compare",
            left: { node: "db", metric: "processed" },
            op: "<",
            right: { node: "redis", metric: "processed" },
          },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{redis}", tip: msg("tutorials.cacheAside.watchGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{redis}" }],
    },
  ],
  finish: { text: msg("tutorials.cacheAside.finishVerified") },
};
