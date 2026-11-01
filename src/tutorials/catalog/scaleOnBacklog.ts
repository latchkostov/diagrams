import { diagnosticLesson } from "./diagnosticLesson";
import { msg } from "../../i18n";
import { backlogScalingPractice } from "../../lab/waitingPractice";
import type { Check, PropPatch, PatchValue, Tutorial } from "../types";
import { livePropertiesGoal } from "./liveProperties";
import { moment, runStep } from "./waitingSteps";

const configuration: Check = {
  kind: "all",
  checks: [
    { kind: "prop", subject: "worker", prop: ["autoscaling", "controller", "kind"], op: "=", value: "keda" },
    {
      kind: "prop",
      subject: "worker",
      prop: ["autoscaling", "controller", "triggers", 0, "source"],
      op: "=",
      value: { node: "render-requests", group: "renders" },
    },
    {
      kind: "prop",
      subject: "worker",
      prop: ["autoscaling", "controller", "triggers", 0, "target"],
      op: "=",
      value: 10,
    },
    { kind: "prop", subject: "worker", prop: ["autoscaling", "controller", "minReplicas"], op: "=", value: 0 },
    { kind: "prop", subject: "worker", prop: ["autoscaling", "controller", "maxReplicas"], op: "=", value: 6 },
  ],
};

const lesson: Tutorial = {
  id: "scale-on-backlog",
  version: 1,
  track: "waiting",
  level: 3,
  minutes: 4,
  title: msg("tutorials.scaleOnBacklog.title"),
  summary: msg("tutorials.scaleOnBacklog.summary"),
  start: backlogScalingPractice,
  subjects: {
    client: { stencils: ["client.browser"] },
    broker: { stencils: ["kafka.topic"] },
    worker: { stencils: ["service.go"] },
  },
  steps: [
    {
      id: "signal",
      title: msg("tutorials.scaleOnBacklog.selectTitle"),
      goal: msg("tutorials.scaleOnBacklog.selectGoal"),
      done: msg("tutorials.scaleOnBacklog.selectDone"),
      check: { kind: "all", checks: [configuration, { kind: "selection", subjects: ["worker"], exact: true }] },
      sticky: true,
      targets: [
        { testId: "autoscaling-target", tip: msg("tutorials.scaleOnBacklog.signalTip") },
        { testId: "node-{worker}", tip: msg("tutorials.scaleOnBacklog.signalGoal") },
      ],
      demo: [
        {
          kind: "patch",
          subject: "worker",
          patches:
            configuration.kind === "all"
              ? configuration.checks.flatMap<PropPatch>((c) =>
                  c.kind === "prop" && Array.isArray(c.prop) && c.op === "="
                    ? [{ op: "set", path: c.prop as [string, ...string[]], value: c.value as PatchValue }]
                    : [],
                )
              : [],
        },
        { kind: "select", subjects: ["worker"] },
      ],
      solution: [{ dblclick: "node-{worker}" }, { press: "Escape" }, { open: "inspector-section-node-simulation" }],
    },
    {
      id: "read-signal",
      title: msg("tutorials.scaleOnBacklog.signalTitle"),
      goal: msg("tutorials.scaleOnBacklog.signalGoal"),
      done: msg("tutorials.scaleOnBacklog.signalDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [
        { testId: "autoscaling-target", tip: msg("tutorials.scaleOnBacklog.signalTip") },
        { testId: "inspector-section-node-simulation", tip: msg("tutorials.scaleOnBacklog.signalTitle") },
      ],
      demo: [],
      solution: [{ open: "inspector-section-node-simulation" }, { click: "tutorial-skip" }],
    },
    runStep(
      "run",
      "wake-on-burst",
      {
        title: msg("tutorials.scaleOnBacklog.runTitle"),
        goal: msg("tutorials.scaleOnBacklog.runGoal"),
        done: msg("tutorials.scaleOnBacklog.runDone"),
      },
      true,
    ),
    moment(
      "starting",
      "worker",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "wake-on-burst", atLeastMs: 2500 },
          { kind: "note", waiting: true },
          { kind: "compare", left: { node: "worker", metric: "fleet.starting" }, op: ">=", right: 1 },
          { kind: "compare", left: { node: "worker", metric: "fleet.ready" }, op: "=", right: 0 },
        ],
      },
      {
        title: msg("tutorials.scaleOnBacklog.startingTitle"),
        goal: msg("tutorials.scaleOnBacklog.startingGoal"),
        done: msg("tutorials.scaleOnBacklog.startingDone"),
      },
    ),
    {
      id: "continue-startup",
      title: msg("tutorials.scaleOnBacklog.continueTitle"),
      goal: msg("tutorials.scaleOnBacklog.continueGoal"),
      done: msg("tutorials.scaleOnBacklog.continueDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "wake-on-burst", atLeastMs: 2500 },
          { kind: "note", waiting: false, currentOnly: true },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.scaleOnBacklog.continueGoal") }],
      demo: [{ kind: "continueNote", simulation: "wake-on-burst", atLeastMs: 2500 }],
      solution: [{ click: "live-note-continue" }],
    },
    {
      id: "ready",
      title: msg("tutorials.scaleOnBacklog.readReadyTitle"),
      goal: msg("tutorials.scaleOnBacklog.readReadyGoal"),
      done: msg("tutorials.scaleOnBacklog.readyDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "wake-on-burst", atLeastMs: 4000 },
          { kind: "note", waiting: true },
          { kind: "readout", subject: "worker" },
          { kind: "compare", left: { node: "worker", metric: "fleet.ready" }, op: ">=", right: 1 },
          { kind: "compare", left: { node: "worker", metric: "processed" }, op: ">=", right: 1 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{worker}", tip: msg("tutorials.scaleOnBacklog.readReadyGoal") }],
      demo: [],
      solution: [{ hover: "node-{worker}" }],
    },
    moment(
      "ceiling",
      "broker",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "wake-on-burst", atLeastMs: 4000 },
          { kind: "note", waiting: true },
          { kind: "compare", left: { node: "worker", metric: "fleet.desired" }, op: "=", right: 3 },
          { kind: "compare", left: { node: "worker", metric: "fleet.ready" }, op: "=", right: 3 },
          { kind: "compare", left: { node: "broker", metric: "backlog" }, op: ">=", right: 1 },
          { kind: "prop", subject: "broker", prop: "partitions", effective: true, op: "=", value: 3 },
          {
            kind: "compare",
            left: { subject: "worker", prop: ["autoscaling", "controller", "maxReplicas"], effective: true },
            op: ">",
            right: { subject: "broker", prop: "partitions", effective: true },
          },
        ],
      },
      {
        title: msg("tutorials.scaleOnBacklog.ceilingTitle"),
        goal: msg("tutorials.scaleOnBacklog.ceilingGoal"),
        done: msg("tutorials.scaleOnBacklog.ceilingDone"),
      },
    ),
    {
      id: "partitions",
      title: msg("tutorials.scaleOnBacklog.partitionsTitle"),
      goal: livePropertiesGoal(msg("tutorials.scaleOnBacklog.partitionsGoal")),
      done: msg("tutorials.scaleOnBacklog.partitionsDone"),
      check: { kind: "prop", subject: "broker", prop: "partitions", op: "=", value: 6 },
      targets: [
        {
          testId: "inspector-field-partitions",
          tip: msg("tutorials.scaleOnBacklog.partitionsGoal"),
          selected: "broker",
        },
        { testId: "dock-edit-properties", tip: msg("tutorials.scaleOnBacklog.partitionsGoal"), selected: "broker" },
        { testId: "node-{broker}", tip: msg("tutorials.scaleOnBacklog.partitionsGoal") },
      ],
      demo: [
        {
          kind: "patch",
          subject: "broker",
          patches: [{ op: "set", path: ["partitions"], value: 6 }],
          runs: ["wake-on-burst"],
        },
      ],
      solution: [
        { dblclick: "node-{broker}" },
        { open: "dock-edit-properties" },
        { open: "inspector-section-node-simulation" },
        { fill: "inspector-field-partitions", text: "6" },
        { press: "Tab" },
      ],
    },
    {
      ...runStep("replay", "wake-on-burst", {
        title: msg("tutorials.scaleOnBacklog.replayTitle"),
        goal: msg("tutorials.scaleOnBacklog.replayGoal"),
        done: msg("tutorials.scaleOnBacklog.replayDone"),
      }),
      targets: [{ testId: "live-restart", tip: msg("tutorials.scaleOnBacklog.replayTitle") }],
      solution: [{ click: "live-restart" }],
      check: {
        kind: "all",
        checks: [
          { kind: "newRun" },
          { kind: "simulation", id: "wake-on-burst" },
          { kind: "prop", subject: "broker", prop: "partitions", effective: true, op: "=", value: 6 },
        ],
      },
    },
    {
      id: "drained",
      title: msg("tutorials.scaleOnBacklog.drainedTitle"),
      goal: msg("tutorials.scaleOnBacklog.drainedGoal"),
      done: msg("tutorials.scaleOnBacklog.drainedDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "wake-on-burst", atLeastMs: 10000 },
          { kind: "note", waiting: false },
          { kind: "prop", subject: "broker", prop: "partitions", effective: true, op: "=", value: 6 },
          {
            kind: "expectation",
            simulation: "wake-on-burst",
            match: { metric: { node: "render-workers", field: "processed" }, op: "==", value: 80, when: "end" },
          },
          {
            kind: "expectation",
            simulation: "wake-on-burst",
            match: {
              metric: { node: "render-requests", field: "lag", group: "renders" },
              op: "==",
              value: 0,
              when: "end",
            },
          },
        ],
      },
      sticky: true,
      targets: [
        { testId: "live-note-continue", tip: msg("tutorials.scaleOnBacklog.drainedGoal") },
        { testId: "live-expectations-summary", tip: msg("tutorials.scaleOnBacklog.drainedGoal") },
      ],
      demo: [{ kind: "continueNote", simulation: "wake-on-burst", atLeastMs: 10000 }],
      solution: [
        { playing: true },
        { click: "live-note-continue" },
        { click: "live-note-continue" },
        { select: "live-speed", value: "8" },
      ],
    },
  ],
  finish: {
    text: msg("tutorials.scaleOnBacklog.finish"),
    example: { slug: "autoscaling-basics", label: msg("tutorials.scaleOnBacklog.example") },
  },
};

export const scaleOnBacklog = diagnosticLesson(lesson, backlogScalingPractice);
