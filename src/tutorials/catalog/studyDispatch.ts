import { livePropertiesGoal } from "./liveProperties";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { studyRun } from "./studyShared";

export const studyDispatch: Tutorial = {
  id: "study-dispatch",
  version: 1,
  track: "studies",
  level: 3,
  minutes: 20,
  study: true,
  title: msg("tutorials.studyDispatch.title"),
  summary: msg("tutorials.studyDispatch.summary"),
  start: () => ({
    format: "diagrams/v2",
    title: t("tutorials.studyDispatch.title"),
    planning: { revision: "p3-w2" },
    nodes: [
      {
        id: "couriers",
        stencil: "client.mobile",
        label: t("tutorials.studyDispatch.couriers"),
        x: 0,
        y: 0,
        props: { ratePerSec: 20 },
      },
      {
        id: "pings",
        stencil: "kafka.topic",
        label: t("tutorials.studyDispatch.pings"),
        x: 300,
        y: 0,
        props: { partitions: 2 },
      },
      {
        id: "dispatcher",
        stencil: "generic.service",
        label: t("tutorials.studyDispatch.dispatcher"),
        x: 600,
        y: 0,
        props: { replicas: 1, concurrency: 1, latencyMs: 100, jitter: 0 },
      },
    ],
    edges: [
      { id: "couriers-pings", from: "couriers", to: "pings", kind: "async" },
      { id: "pings-dispatcher", from: "pings", to: "dispatcher", kind: "async" },
    ],
    simulations: [
      {
        ...studyRun("dinner-rush", msg("tutorials.studyDispatch.rushRun")),
        traffic: [{ id: "pings", node: "couriers", shape: { kind: "constant", ratePerSec: 15, durationMs: 12_000 } }],
        expectations: [
          {
            id: "bounded",
            label: t("tutorials.studyDispatch.bounded"),
            metric: { node: "pings", field: "backlog" },
            op: "<=",
            value: 8,
            when: "at",
            atMs: 4000,
          },
        ],
      },
      {
        ...studyRun("more-partitions", msg("tutorials.studyDispatch.partitionsRun")),
        traffic: [{ id: "pings", node: "couriers", shape: { kind: "constant", ratePerSec: 30, durationMs: 12_000 } }],
        expectations: [
          {
            id: "bounded",
            label: t("tutorials.studyDispatch.bounded"),
            metric: { node: "pings", field: "backlog" },
            op: "<=",
            value: 24,
            when: "at",
            atMs: 4000,
          },
        ],
      },
    ],
  }),
  subjects: {
    couriers: { stencils: ["client.mobile"] },
    topic: { stencils: ["kafka.topic"] },
    dispatcher: { stencils: ["generic.service"] },
  },
  steps: [
    {
      id: "handle-dinner-rush",
      title: msg("tutorials.studyDispatch.rushTitle"),
      goal: msg("tutorials.studyDispatch.rushGoal"),
      hint: msg("tutorials.studyDispatch.rushHint"),
      done: msg("tutorials.studyDispatch.rushDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "dinner-rush", atLeastMs: 4000 },
          { kind: "expectation", simulation: "dinner-rush", label: msg("tutorials.studyDispatch.bounded") },
          { kind: "metric", subject: "dispatcher", field: "processed", op: ">=", value: 10 },
        ],
      },
      targets: [{ testId: "node-{dispatcher}", tip: msg("tutorials.studyDispatch.rushHint") }],
      demo: [
        {
          kind: "patch",
          subject: "dispatcher",
          runs: ["dinner-rush"],
          patches: [{ op: "set", path: ["replicas"], value: 2 }],
        },
        { kind: "runSimulation", id: "dinner-rush" },
      ],
      solution: [
        { dblclick: "node-{dispatcher}" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-replicas", text: "2" },
        { press: "Enter" },
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "dinner-rush" },
      ],
    },
    // Owner decision 7 (2026-10-25): compare partitions with consumers and judge each run's own expectations.
    {
      id: "fix-partition-ceiling",
      title: msg("tutorials.studyDispatch.fixTitle"),
      goal: livePropertiesGoal(msg("tutorials.studyDispatch.fixGoal")),
      hint: msg("tutorials.studyDispatch.fixHint"),
      done: msg("tutorials.studyDispatch.fixDone"),
      sticky: true,
      check: {
        kind: "all",
        checks: [
          {
            kind: "compare",
            left: { subject: "topic", prop: "partitions", effective: true },
            op: ">=",
            right: { subject: "dispatcher", prop: "replicas", effective: true },
          },
          { kind: "prop", effective: true, subject: "dispatcher", prop: "replicas", op: ">=", value: 4 },
          { kind: "simulation", id: "more-partitions", atLeastMs: 4000 },
          { kind: "expectation", simulation: "more-partitions", label: msg("tutorials.studyDispatch.bounded") },
          { kind: "metric", subject: "dispatcher", field: "processed", op: ">=", value: 10 },
        ],
      },
      targets: [
        {
          testId: "dock-edit-properties",
          tip: livePropertiesGoal(msg("tutorials.studyDispatch.fixGoal")),
          selected: "topic",
        },
        { testId: "node-{topic}", tip: msg("tutorials.studyDispatch.fixHint") },
      ],
      demo: [
        {
          kind: "patch",
          subject: "dispatcher",
          runs: ["more-partitions"],
          patches: [{ op: "set", path: ["replicas"], value: 4 }],
        },
        {
          kind: "patch",
          subject: "topic",
          runs: ["more-partitions"],
          patches: [{ op: "set", path: ["partitions"], value: 4 }],
        },
        { kind: "runSimulation", id: "more-partitions" },
      ],
      solution: [
        { dblclick: "node-{dispatcher}" },
        { open: "dock-edit-properties" },
        { fill: "inspector-field-replicas", text: "4" },
        { press: "Enter" },
        { dblclick: "node-{topic}" },
        { open: "dock-edit-properties" },
        { fill: "inspector-field-partitions", text: "4" },
        { press: "Enter" },
        { select: "live-sim-picker", value: "more-partitions" },
      ],
    },
  ],
  finish: {
    text: msg("tutorials.studyDispatch.finish"),
    example: { slug: "delivery-dispatch", label: msg("tutorials.studyDispatch.reference") },
  },
};
