import { msg } from "../../i18n";
import type { Tutorial } from "../types";

export const healthChecks: Tutorial = {
  id: "health-checks",
  version: 1,
  track: "resilience",
  level: 2,
  minutes: 3,
  title: msg("tutorials.healthChecks.title"),
  summary: msg("tutorials.healthChecks.summary"),
  start: { example: "zone-outage-drill" },
  subjects: {
    balancer: { stencils: ["aws.elb"] },
    apiA: { stencils: ["aws.ecs"] },
    apiB: { stencils: ["aws.ecs"] },
    ordersA: { stencils: ["aws.dynamodb"] },
  },
  steps: [
    {
      id: "without-checks",
      title: msg("tutorials.healthChecks.withoutTitle"),
      goal: msg("tutorials.healthChecks.withoutGoal"),
      done: msg("tutorials.healthChecks.withoutDone"),
      check: { kind: "simulation", id: "no-health-checks" },
      sticky: true,
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.healthChecks.withoutGoal") },
        { testId: "live-toggle", tip: msg("tutorials.healthChecks.withoutGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "no-health-checks" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "no-health-checks" }],
    },
    {
      id: "watch-loss",
      title: msg("tutorials.healthChecks.lossTitle"),
      goal: msg("tutorials.healthChecks.lossGoal"),
      done: msg("tutorials.healthChecks.lossDone"),
      // A down node drops arrivals; it does not count them as failed processing attempts.
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "no-health-checks" },
          { kind: "compare", left: { node: "apiB", metric: "dropped" }, op: ">=", right: 1 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{apiB}", tip: msg("tutorials.healthChecks.lossGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{apiB}" }],
    },
    {
      id: "with-checks",
      title: msg("tutorials.healthChecks.withTitle"),
      goal: msg("tutorials.healthChecks.withGoal"),
      done: msg("tutorials.healthChecks.withDone"),
      check: { kind: "simulation", id: "health-checks" },
      targets: [{ testId: "live-sim-picker", tip: msg("tutorials.healthChecks.withGoal") }],
      demo: [{ kind: "runSimulation", id: "health-checks" }],
      solution: [{ select: "live-sim-picker", value: "health-checks" }],
    },
    {
      id: "watch-protection",
      title: msg("tutorials.healthChecks.protectionTitle"),
      goal: msg("tutorials.healthChecks.protectionGoal"),
      done: msg("tutorials.healthChecks.protectionDone"),
      check: {
        kind: "all",
        checks: [
          // Zero losses at the beginning proves nothing: wait for the entire seeded outage run.
          { kind: "simulation", id: "health-checks", atLeastMs: 9000 },
          { kind: "compare", left: { sum: "dropped", nodes: ["apiA", "apiB"] }, op: "<=", right: 1 },
          { kind: "compare", left: { node: "ordersA", metric: "processed" }, op: ">=", right: 20 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{balancer}", tip: msg("tutorials.healthChecks.protectionGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{balancer}" }],
    },
  ],
  finish: {
    text: msg("tutorials.healthChecks.finish"),
    example: { slug: "zone-outage-drill", label: msg("tutorials.healthChecks.example") },
  },
};
