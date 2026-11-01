import { diagnosticLesson } from "./diagnosticLesson";
import reference from "../../examples/scale-on-busy-threads.json";
import type { DiagramFile } from "../../model/types";
import { livePropertiesGoal } from "./liveProperties";
import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { moment, patchStep, runStep } from "./waitingSteps";

const lesson: Tutorial = {
  id: "autoscaling",
  version: 3,
  track: "waiting",
  level: 3,
  minutes: 5,
  title: msg("tutorials.autoscaling.title"),
  summary: msg("tutorials.autoscaling.summaryV3"),
  start: { example: "scale-on-busy-threads" },
  subjects: { caller: { stencils: ["generic.service"] } },
  steps: [
    {
      id: "inspect-controller",
      title: msg("tutorials.autoscaling.selectTitleV3"),
      goal: msg("tutorials.autoscaling.selectGoalV3"),
      done: msg("tutorials.autoscaling.selectDoneV3"),
      check: {
        kind: "all",
        checks: [
          { kind: "selection", subjects: ["caller"], exact: true },
          { kind: "prop", subject: "caller", prop: ["autoscaling", "controller", "kind"], op: "=", value: "hpa" },
          {
            kind: "prop",
            subject: "caller",
            prop: ["autoscaling", "controller", "settings", "metrics", 0, "target"],
            op: "=",
            value: { kind: "utilization", percentOfRequest: 70 },
          },
          { kind: "prop", subject: "caller", prop: ["autoscaling", "controller", "minReplicas"], op: "=", value: 4 },
          { kind: "prop", subject: "caller", prop: ["autoscaling", "controller", "maxReplicas"], op: "=", value: 10 },
        ],
      },
      sticky: true,
      targets: [
        { testId: "autoscaling-target", tip: msg("tutorials.autoscaling.inspectTitleV3") },
        { testId: "node-{caller}", tip: msg("tutorials.autoscaling.inspectTitleV3") },
      ],
      demo: [{ kind: "select", subjects: ["caller"] }],
      solution: [{ dblclick: "node-{caller}" }, { press: "Escape" }, { open: "inspector-section-node-simulation" }],
    },
    {
      id: "read-controller",
      title: msg("tutorials.autoscaling.inspectTitleV3"),
      goal: msg("tutorials.autoscaling.inspectGoalV3"),
      done: msg("tutorials.autoscaling.inspectDoneV3"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [
        { testId: "autoscaling-target", tip: msg("tutorials.autoscaling.inspectTitleV3") },
        { testId: "inspector-section-node-simulation", tip: msg("tutorials.autoscaling.inspectTitleV3") },
      ],
      demo: [],
      solution: [{ open: "inspector-section-node-simulation" }, { click: "tutorial-skip" }],
    },
    runStep(
      "run-busy-threads",
      "busy-threads",
      {
        title: msg("tutorials.autoscaling.runTitle"),
        goal: msg("tutorials.autoscaling.runGoal"),
        done: msg("tutorials.autoscaling.runDone"),
      },
      true,
    ),
    patchStep(
      "scale-on-busy-threads",
      { subject: "caller" },
      [
        {
          op: "set",
          path: ["autoscaling", "controller", "settings", "metrics", 0, "source"],
          value: { kind: "pods", metric: "busyThreads" },
        },
      ],
      {
        kind: "prop",
        subject: "caller",
        prop: ["autoscaling", "controller", "settings", "metrics", 0, "source"],
        op: "=",
        value: { kind: "pods", metric: "busyThreads" },
      },
      "autoscaling-metric",
      [
        { dblclick: "node-{caller}" },
        { open: "dock-edit-properties" },
        { open: "inspector-section-node-simulation" },
        { open: "autoscaling-advanced-toggle" },
        { select: "autoscaling-metric", value: "busyThreads" },
      ],
      {
        title: msg("tutorials.autoscaling.scaleTitle"),
        goal: livePropertiesGoal(msg("tutorials.autoscaling.scaleGoalV3")),
        done: msg("tutorials.autoscaling.scaleDoneV3"),
      },
    ),
    moment(
      "replicas-grow",
      "caller",
      {
        kind: "all",
        checks: [
          { kind: "simulation", id: "busy-threads" },
          // Seed 17: 6 replicas at 9 s; the initial 4 is >30% below that reading.
          { kind: "compare", left: { node: "caller", metric: "replicas" }, op: ">", right: 4 },
        ],
      },
      {
        title: msg("tutorials.autoscaling.growTitle"),
        goal: msg("tutorials.autoscaling.growGoalV3"),
        done: msg("tutorials.autoscaling.growDoneV3"),
      },
    ),
  ],
  finish: { text: msg("tutorials.autoscaling.finishV3") },
};

export const autoscaling = diagnosticLesson(lesson, () => structuredClone(reference) as DiagramFile);
