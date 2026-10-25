import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

// owner decision pending: 5. Build 09, load-shedding (earlier owner decision 10)
// The explicit shedding setting and spike interaction remain undecided. Author the seeded overload first;
// do not choose the max-in-flight fallback or a replacement Inject interaction on the owner's behalf.
export const loadShedding: Tutorial = {
  id: "load-shedding",
  quarantined: true,
  version: 1,
  track: "resilience",
  level: 3,
  minutes: 4,
  title: msg("tutorials.loadShedding.title"),
  summary: msg("tutorials.loadShedding.summary"),
  start: () => ({
    format: "diagrams/v2",
    planning: { revision: "p3-w1" },
    title: t("tutorials.loadShedding.title"),
    nodes: [
      {
        id: "client",
        stencil: "client.mobile",
        label: t("tutorials.loadShedding.clientName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 0 },
      },
      {
        id: "api",
        stencil: "generic.service",
        label: t("tutorials.loadShedding.apiName"),
        x: 300,
        y: 0,
        props: { concurrency: 2, latencyMs: 10, jitter: 0 },
      },
      {
        id: "db",
        stencil: "postgres",
        label: t("tutorials.loadShedding.dbName"),
        x: 600,
        y: 0,
        props: { latencyMs: 1000, jitter: 0 },
      },
    ],
    edges: [
      { id: "request", from: "client", to: "api", kind: "sync", props: { travelMs: 10 } },
      { id: "query", from: "api", to: "db", kind: "sync", props: { travelMs: 10 } },
    ],
    simulations: [
      {
        id: "spike",
        title: t("tutorials.loadShedding.spikeName"),
        seed: 20261025,
        scale: 1,
        durationMs: 10_000,
        traffic: [{ id: "spike", node: "client", shape: { kind: "burst", count: 100, spreadMs: 1000 } }],
        timeline: [],
        expectations: [],
      },
    ],
  }),
  subjects: {
    client: { stencils: ["client.mobile"] },
    api: { stencils: ["generic.service"] },
    db: { stencils: ["postgres"] },
  },
  steps: [
    {
      id: "run-spike",
      title: msg("tutorials.loadShedding.spikeTitle"),
      goal: msg("tutorials.loadShedding.spikeGoal"),
      done: msg("tutorials.loadShedding.spikeDone"),
      check: { kind: "simulation", id: "spike" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.loadShedding.spikeGoal") },
        { testId: "live-toggle", tip: msg("tutorials.loadShedding.spikeGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "spike" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "spike" }],
    },
    {
      id: "watch-backlog",
      title: msg("tutorials.loadShedding.backlogTitle"),
      goal: msg("tutorials.loadShedding.backlogGoal"),
      done: msg("tutorials.loadShedding.backlogDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "spike" },
          { kind: "compare", left: { node: "api", metric: "backlog" }, op: ">=", right: 24 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{api}", tip: msg("tutorials.loadShedding.backlogGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{api}" }],
    },
  ],
  finish: { text: msg("tutorials.loadShedding.finish") },
};
