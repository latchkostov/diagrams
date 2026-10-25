import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { moment } from "./waitingSteps";

export const rateLimit: Tutorial = {
  id: "rate-limit",
  version: 2,
  track: "resilience",
  level: 2,
  minutes: 4,
  title: msg("tutorials.rateLimit.title"),
  summary: msg("tutorials.rateLimit.summary"),
  start: () => ({
    format: "diagrams/v2",
    title: t("tutorials.rateLimit.title"),
    planning: { revision: "p3" },
    nodes: [
      {
        id: "partner",
        stencil: "client.user",
        label: t("tutorials.rateLimit.partnerName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 20 },
      },
      {
        id: "limiter",
        stencil: "generic.rate-limiter",
        label: t("tutorials.rateLimit.limiterName"),
        x: 300,
        y: 0,
        props: {
          latencyMs: 0,
          api: {
            quotas: [{ id: "local-rate", unit: "requests", amount: 30, windowMs: 1000, algorithm: "token-bucket" }],
          },
        },
      },
      {
        id: "api",
        stencil: "generic.service",
        label: t("tutorials.rateLimit.apiName"),
        x: 600,
        y: 0,
        props: { latencyMs: 10, jitter: 0 },
      },
    ],
    edges: [
      { id: "partner-limiter", from: "partner", to: "limiter", kind: "sync" },
      { id: "limiter-api", from: "limiter", to: "api", kind: "sync" },
    ],
    simulations: [
      {
        id: "partner-traffic",
        title: t("tutorials.rateLimit.runName"),
        seed: 20261025,
        scale: 1,
        durationMs: 10000,
        traffic: [{ id: "partner", node: "partner", shape: { kind: "constant", ratePerSec: 20, durationMs: 10000 } }],
      },
    ],
  }),
  subjects: {
    partner: { stencils: ["client.user"] },
    limiter: { stencils: ["generic.rate-limiter"] },
    api: { stencils: ["generic.service"] },
  },
  steps: [
    {
      id: "quota-10",
      title: msg("tutorials.rateLimit.quotaTitle"),
      goal: msg("tutorials.rateLimit.quotaGoal"),
      done: msg("tutorials.rateLimit.quotaDone"),
      check: {
        kind: "prop",
        subject: "limiter",
        prop: ["api", "quotas", { where: { id: "local-rate" } }, "amount"],
        op: "=",
        value: 10,
      },
      targets: [
        { testId: "inspector-field-rate-limit", tip: msg("tutorials.rateLimit.quotaGoal") },
        { testId: "node-{limiter}", tip: msg("tutorials.rateLimit.quotaGoal") },
      ],
      demo: [
        {
          kind: "patch",
          subject: "limiter",
          patches: [{ op: "set", path: ["api", "quotas", { where: { id: "local-rate" } }, "amount"], value: 10 }],
        },
      ],
      solution: [
        { dblclick: "node-{limiter}" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-rate-limit", text: "10" },
        { press: "Enter" },
      ],
    },
    {
      id: "run",
      title: msg("tutorials.rateLimit.runTitle"),
      goal: msg("tutorials.rateLimit.runGoal"),
      done: msg("tutorials.rateLimit.runDone"),
      check: { kind: "simulation", id: "partner-traffic" },
      sticky: true,
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.rateLimit.runGoal") },
        { testId: "live-toggle", tip: msg("tutorials.rateLimit.runGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "partner-traffic" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "partner-traffic" }],
    },
    moment(
      "rejected",
      "limiter",
      { kind: "metric", subject: "limiter", field: "rejected", op: ">=", value: 10 },
      {
        title: msg("tutorials.rateLimit.rejectedTitle"),
        goal: msg("tutorials.rateLimit.rejectedGoal"),
        done: msg("tutorials.rateLimit.rejectedDone"),
      },
    ),
  ],
  finish: { text: msg("tutorials.rateLimit.finish") },
};
