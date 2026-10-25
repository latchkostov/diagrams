import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { studyAdd, studyRun } from "./studyShared";

export const studyCheckout: Tutorial = {
  id: "study-checkout",
  version: 1,
  // quarantined: see docs/backlog/2026-10-24-tutorials-quarantine.md
  quarantined: true,
  track: "studies",
  level: 3,
  minutes: 20,
  study: true,
  title: msg("tutorials.studyCheckout.title"),
  summary: msg("tutorials.studyCheckout.summary"),
  start: () => ({
    format: "diagrams/v2",
    title: t("tutorials.studyCheckout.title"),
    planning: { revision: "p3-w2" },
    nodes: [
      {
        id: "storefront",
        stencil: "client.browser",
        label: t("tutorials.studyCheckout.storefront"),
        x: 0,
        y: 0,
        props: { ratePerSec: 4 },
      },
      {
        id: "checkout",
        stencil: "generic.service",
        label: t("tutorials.studyCheckout.checkout"),
        x: 300,
        y: 0,
        props: { replicas: 1, concurrency: 1, latencyMs: 100, jitter: 0, queue: { limit: 10 } },
      },
      {
        id: "payments",
        stencil: "generic.external-api",
        label: t("tutorials.studyCheckout.payments"),
        x: 600,
        y: -160,
        props: {
          api: {
            latencyMs: 200,
            quotas: [
              { id: "partner", unit: "requests", amount: 100, windowMs: 1000, burst: 100, algorithm: "token-bucket" },
            ],
          },
        },
      },
      { id: "orders", stencil: "postgres", label: t("tutorials.studyCheckout.orders"), x: 600, y: 160 },
    ],
    edges: [
      { id: "storefront-checkout", from: "storefront", to: "checkout", kind: "sync" },
      { id: "checkout-payments", from: "checkout", to: "payments", kind: "sync" },
      { id: "checkout-orders", from: "checkout", to: "orders", kind: "sync" },
    ],
    simulations: [
      {
        ...studyRun("tenfold", msg("tutorials.studyCheckout.tenfoldRun")),
        multipliers: { traffic: 10 },
        traffic: [
          { id: "shoppers", node: "storefront", shape: { kind: "constant", ratePerSec: 4, durationMs: 12_000 } },
        ],
        expectations: [
          {
            id: "no-drops",
            label: t("tutorials.studyCheckout.noDrops"),
            metric: { node: "checkout", field: "dropped" },
            op: "==",
            value: 0,
            when: "at",
            atMs: 4000,
          },
        ],
      },
      {
        ...studyRun("partner-quota", msg("tutorials.studyCheckout.quotaRun")),
        multipliers: { traffic: 10 },
        setup: {
          props: {
            payments: {
              api: {
                latencyMs: 200,
                quotas: [
                  { id: "partner", unit: "requests", amount: 10, windowMs: 1000, burst: 10, algorithm: "token-bucket" },
                ],
              },
            },
          },
        },
        traffic: [
          { id: "shoppers", node: "storefront", shape: { kind: "constant", ratePerSec: 4, durationMs: 12_000 } },
        ],
      },
    ],
  }),
  subjects: {
    storefront: { stencils: ["client.browser"] },
    checkout: { stencils: ["generic.service"] },
    payments: { stencils: ["generic.external-api"] },
    orders: { stencils: ["postgres"] },
    topic: { stencils: ["kafka.topic"] },
    consumer: { stencils: ["service.java"] },
  },
  steps: [
    {
      id: "survive-tenfold",
      title: msg("tutorials.studyCheckout.rushTitle"),
      goal: msg("tutorials.studyCheckout.rushGoal"),
      hint: msg("tutorials.studyCheckout.rushHint"),
      done: msg("tutorials.studyCheckout.rushDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "tenfold", atLeastMs: 4000 },
          { kind: "expectation", simulation: "tenfold", label: msg("tutorials.studyCheckout.noDrops") },
          { kind: "metric", subject: "checkout", field: "processed", op: ">=", value: 20 },
        ],
      },
      targets: [{ testId: "node-{checkout}", tip: msg("tutorials.studyCheckout.rushHint") }],
      demo: [
        { kind: "patch", subject: "checkout", patches: [{ op: "set", path: ["replicas"], value: 20 }] },
        { kind: "runSimulation", id: "tenfold" },
      ],
      solution: [
        { dblclick: "node-{checkout}" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-replicas", text: "20" },
        { press: "Enter" },
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "tenfold" },
      ],
    },
    {
      id: "keep-orders",
      title: msg("tutorials.studyCheckout.ordersTitle"),
      goal: msg("tutorials.studyCheckout.ordersGoal"),
      hint: msg("tutorials.studyCheckout.ordersHint"),
      done: msg("tutorials.studyCheckout.ordersDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "relation", from: "checkout", to: "orders", relation: "flow", edgeKind: "sync" },
          { kind: "relation", from: "checkout", to: "topic", relation: "flow", edgeKind: "async" },
          { kind: "relation", from: "topic", to: "consumer", relation: "flow", edgeKind: "async" },
        ],
      },
      targets: [{ testId: "node-{checkout}", tip: msg("tutorials.studyCheckout.ordersHint") }],
      demo: [
        { kind: "connect", from: "checkout", to: "orders" },
        { kind: "relation", from: "checkout", to: "orders", relation: "flow", edgeKind: "sync" },
        { kind: "add", subject: "topic", stencil: "kafka.topic", after: "checkout" },
        { kind: "add", subject: "consumer", stencil: "service.java", after: "topic" },
        { kind: "relation", from: "checkout", to: "topic", relation: "flow", edgeKind: "async" },
        { kind: "relation", from: "topic", to: "consumer", relation: "flow", edgeKind: "async" },
      ],
      solution: [
        { click: "live-toggle" },
        ...studyAdd("checkout", msg("tutorials.studyCheckout.searchTopic")),
        ...studyAdd(null, msg("tutorials.studyCheckout.searchConsumer")),
      ],
    },
    {
      id: "respect-partner-quota",
      title: msg("tutorials.studyCheckout.quotaTitle"),
      goal: msg("tutorials.studyCheckout.quotaGoal"),
      hint: msg("tutorials.studyCheckout.quotaHint"),
      done: msg("tutorials.studyCheckout.quotaDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "partner-quota", atLeastMs: 4000 },
          { kind: "metric", subject: "payments", field: "rejected", op: "<=", value: 1 },
          { kind: "metric", subject: "payments", field: "processed", op: ">=", value: 10 },
        ],
      },
      targets: [{ testId: "node-{payments}", tip: msg("tutorials.studyCheckout.quotaHint") }],
      demo: [
        {
          kind: "patch",
          edge: ["checkout", "payments"],
          patches: [{ op: "set", path: ["caller", "poolConnections"], value: 1 }],
        },
        { kind: "runSimulation", id: "partner-quota" },
      ],
      solution: [
        { click: "fit-view-button" },
        { click: "node-{payments}" },
        { press: "Control+Alt+[" },
        { click: "inspector-section-edge-simulation" },
        { click: "inspector-section-call-advanced" },
        { fill: "inspector-field-poolConnections", text: "1" },
        { press: "Enter" },
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "partner-quota" },
      ],
    },
  ],
  finish: {
    text: msg("tutorials.studyCheckout.finish"),
    example: { slug: "black-friday-commerce", label: msg("tutorials.studyCheckout.reference") },
  },
};
