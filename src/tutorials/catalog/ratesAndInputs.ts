import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { practiceRun } from "./buildingBlocks";

export const ratesAndInputs: Tutorial = {
  id: "rates-and-inputs",
  version: 2,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.ratesAndInputs.title"),
  summary: msg("tutorials.ratesAndInputs.summaryV2"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.ratesAndInputs.title"),
    nodes: [
      {
        id: "client",
        stencil: "client.mobile",
        label: t("tutorials.ratesAndInputs.clientName"),
        x: 0,
        y: 0,
        props: { ratePerSec: 2 },
      },
      {
        id: "service",
        stencil: "generic.service",
        label: t("tutorials.ratesAndInputs.serviceName"),
        x: 280,
        y: 0,
        // Keep capacity above eighteen requests/s so the multiplier shows in Processed.
        props: { latencyMs: 100 },
      },
    ],
    edges: [{ id: "request", from: "client", to: "service", kind: "sync" }],
    simulations: [
      {
        ...practiceRun(msg("tutorials.ratesAndInputs.runName")),
        traffic: [{ id: "requests", node: "client", shape: { kind: "constant", ratePerSec: 6, durationMs: 600_000 } }],
      },
    ],
  }),
  subjects: { client: { stencils: ["client.mobile"] }, service: { stencils: ["generic.service"] } },
  steps: [
    {
      id: "rate",
      title: msg("tutorials.ratesAndInputs.rateTitle"),
      goal: msg("tutorials.ratesAndInputs.rateGoal"),
      done: msg("tutorials.ratesAndInputs.rateDone"),
      check: { kind: "prop", subject: "client", prop: "ratePerSec", op: "=", value: 6 },
      targets: [
        { testId: "inspector-field-ratePerSec", tip: msg("tutorials.ratesAndInputs.rateGoal") },
        { testId: "node-{client}", tip: msg("tutorials.ratesAndInputs.rateGoal") },
      ],
      demo: [{ kind: "patch", subject: "client", patches: [{ op: "set", path: ["ratePerSec"], value: 6 }] }],
      solution: [
        { click: "node-{client}" },
        { click: "inspector-section-node-simulation" },
        { fill: "inspector-field-ratePerSec", text: "6" },
        { press: "Enter" },
      ],
    },
    {
      id: "free-play",
      title: msg("tutorials.ratesAndInputs.freePlayTitle"),
      goal: () =>
        t("tutorials.ratesAndInputs.freePlayGoal", {
          client: t("tutorials.ratesAndInputs.clientName"),
          service: t("tutorials.ratesAndInputs.serviceName"),
        }),
      done: msg("tutorials.ratesAndInputs.freePlayDone"),
      check: { kind: "all", checks: [{ kind: "freePlay" }, { kind: "processed", subject: "service", atLeast: 1 }] },
      sticky: true,
      targets: [{ testId: "live-toggle", tip: msg("tutorials.ratesAndInputs.freePlayTitle") }],
      demo: [{ kind: "live" }],
      solution: [{ click: "live-toggle" }],
    },
    {
      id: "live",
      title: msg("tutorials.ratesAndInputs.liveTitle"),
      goal: () => t("tutorials.ratesAndInputs.liveGoalV2", { run: t("tutorials.ratesAndInputs.runName") }),
      done: () => t("tutorials.ratesAndInputs.liveDoneV2", { run: t("tutorials.ratesAndInputs.runName") }),
      check: { kind: "simulation", id: "tutorial-flow", traffic: false },
      targets: [
        {
          testId: "live-sim-picker",
          tip: () => t("tutorials.ratesAndInputs.liveGoalV2", { run: t("tutorials.ratesAndInputs.runName") }),
        },
        {
          testId: "live-toggle",
          tip: () => t("tutorials.ratesAndInputs.liveGoalV2", { run: t("tutorials.ratesAndInputs.runName") }),
        },
      ],
      demo: [{ kind: "runSimulation", id: "tutorial-flow" }],
      solution: [{ select: "live-sim-picker", value: "tutorial-flow" }],
    },
    {
      id: "inputs",
      title: msg("tutorials.ratesAndInputs.inputsTitle"),
      goal: msg("tutorials.ratesAndInputs.inputsGoal"),
      done: msg("tutorials.ratesAndInputs.inputsDone"),
      check: { kind: "liveView", view: "inputs", open: true },
      sticky: true,
      targets: [{ testId: "live-capacity", tip: msg("tutorials.ratesAndInputs.inputsGoal") }],
      demo: [{ kind: "openView", view: "inputs" }],
      solution: [{ click: "live-capacity" }],
    },
    {
      id: "traffic",
      title: msg("tutorials.ratesAndInputs.trafficTitle"),
      goal: msg("tutorials.ratesAndInputs.trafficGoal"),
      done: msg("tutorials.ratesAndInputs.trafficDone"),
      check: { kind: "inputs", input: "traffic", op: "=", value: 3 },
      targets: [{ testId: "capacity-traffic-mult", tip: msg("tutorials.ratesAndInputs.trafficGoal") }],
      demo: [{ kind: "inputs", input: "traffic", value: 3 }],
      solution: [
        { click: "capacity-traffic-mult" },
        { press: "End" },
        { press: "ArrowLeft" },
        { press: "ArrowLeft" },
        { press: "ArrowLeft" },
        { press: "ArrowLeft" },
        { press: "ArrowLeft" },
      ],
    },
    {
      id: "watch",
      title: msg("tutorials.ratesAndInputs.watchTitle"),
      goal: () => t("tutorials.ratesAndInputs.watchGoalV2", { service: t("tutorials.ratesAndInputs.serviceName") }),
      done: msg("tutorials.ratesAndInputs.watchDone"),
      check: { kind: "processed", subject: "service", atLeast: 30 },
      sticky: true,
      targets: [
        {
          testId: "node-{service}",
          tip: () => t("tutorials.ratesAndInputs.watchGoalV2", { service: t("tutorials.ratesAndInputs.serviceName") }),
          dim: false,
        },
      ],
      demo: [],
      solution: [{ hover: "node-{service}" }],
    },
    {
      id: "offered",
      title: msg("tutorials.ratesAndInputs.offeredTitle"),
      goal: () =>
        t("tutorials.ratesAndInputs.offeredGoal", {
          service: t("tutorials.ratesAndInputs.serviceName"),
          run: t("tutorials.ratesAndInputs.runName"),
        }),
      done: msg("tutorials.ratesAndInputs.offeredDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "inputs", input: "traffic", op: "=", value: 3 },
          { kind: "planning", subject: "service", constraint: "threads", offered: 18 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{service}", tip: msg("tutorials.ratesAndInputs.offeredTitle") }],
      demo: [],
      solution: [{ dblclick: "node-{service}" }, { open: "dock-edit-properties" }],
    },
    {
      id: "scale",
      title: msg("tutorials.ratesAndInputs.scaleTitle"),
      goal: msg("tutorials.ratesAndInputs.scaleGoal"),
      done: msg("tutorials.ratesAndInputs.scaleDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "inputs", input: "scale", op: "=", value: 2 },
          { kind: "inputs", input: "traffic", op: "=", value: 3 },
        ],
      },
      sticky: true,
      targets: [{ testId: "scale-override", tip: msg("tutorials.ratesAndInputs.scaleTitle") }],
      demo: [{ kind: "inputs", input: "scale", value: 2 }],
      solution: [{ click: "live-capacity" }, { select: "scale-override", value: "2" }],
    },
  ],
  finish: { text: msg("tutorials.ratesAndInputs.finishV2") },
};
