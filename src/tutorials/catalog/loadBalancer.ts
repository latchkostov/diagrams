import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { liveStep, practiceRun } from "./buildingBlocks";

export const loadBalancer: Tutorial = {
  id: "load-balancer",
  version: 1,
  track: "blocks",
  level: 1,
  minutes: 3,
  title: msg("tutorials.loadBalancer.title"),
  summary: msg("tutorials.loadBalancer.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.loadBalancer.title"),
    nodes: [
      {
        id: "app",
        stencil: "client.mobile",
        label: t("tutorials.loadBalancer.appName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 8 },
      },
      { id: "lb", stencil: "load-balancer", label: t("tutorials.loadBalancer.lbName"), x: 240, y: 0 },
      {
        id: "service",
        stencil: "generic.service",
        label: t("tutorials.loadBalancer.serviceName"),
        x: 480,
        y: 0,
        props: { replicas: 1 },
      },
    ],
    edges: [
      { id: "app-lb", from: "app", to: "lb", kind: "sync" },
      { id: "lb-service", from: "lb", to: "service", kind: "sync" },
    ],
    simulations: [practiceRun(msg("tutorials.loadBalancer.runName"))],
  }),
  subjects: {
    app: { stencils: ["client.mobile"] },
    lb: { stencils: ["load-balancer"] },
    service: { stencils: ["generic.service"] },
  },
  steps: [
    {
      id: "replicas",
      title: msg("tutorials.loadBalancer.replicasTitle"),
      goal: msg("tutorials.loadBalancer.replicasGoal"),
      done: msg("tutorials.loadBalancer.replicasDone"),
      // A milestone: the later step deliberately changes this same property.
      sticky: true,
      check: { kind: "all", checks: [{ kind: "prop", subject: "service", prop: "replicas", op: "=", value: 3 }] },
      targets: [
        { testId: "inspector-field-replicas", tip: msg("tutorials.loadBalancer.replicasGoal"), selected: "service" },
        {
          testId: "inspector-section-node-simulation",
          tip: msg("tutorials.loadBalancer.replicasGoal"),
          selected: "service",
        },
        { testId: "node-{service}", tip: msg("tutorials.loadBalancer.replicasGoal") },
      ],
      demo: [{ kind: "prop", subject: "service", props: { replicas: 3 } }],
      solution: [
        { click: "node-{service}" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-replicas", text: "3" },
        { press: "Enter" },
      ],
    },
    liveStep(
      msg("tutorials.loadBalancer.liveTitle"),
      msg("tutorials.loadBalancer.liveGoal"),
      msg("tutorials.loadBalancer.liveDone"),
    ),
    {
      id: "fault",
      title: msg("tutorials.loadBalancer.faultTitle"),
      goal: msg("tutorials.loadBalancer.faultGoal"),
      done: msg("tutorials.loadBalancer.faultDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "live" },
          { kind: "prop", subject: "service", prop: "replicas", op: "=", value: 2 },
          { kind: "metric", subject: "service", field: "replicas", op: "=", value: 2 },
        ],
      },
      targets: [
        { testId: "inspector-field-replicas", tip: msg("tutorials.loadBalancer.faultGoal"), selected: "service" },
        { testId: "node-{service}", tip: msg("tutorials.loadBalancer.faultGoal") },
      ],
      demo: [{ kind: "prop", subject: "service", props: { replicas: 2 } }],
      solution: [{ dblclick: "node-{service}" }, { fill: "inspector-field-replicas", text: "2" }, { press: "Enter" }],
    },
    {
      id: "watch",
      title: msg("tutorials.loadBalancer.watchTitle"),
      goal: msg("tutorials.loadBalancer.watchGoal"),
      done: msg("tutorials.loadBalancer.watchDone"),
      check: { kind: "compare", left: { sinceStep: { node: "service", metric: "processed" } }, op: ">=", right: 10 },
      sticky: true,
      targets: [{ testId: "node-{service}", tip: msg("tutorials.loadBalancer.watchGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{service}" }],
    },
  ],
  finish: { text: msg("tutorials.loadBalancer.finish") },
};
