import { msg } from "../../i18n";
import type { Tutorial } from "../types";
import { moment, patchStep, runStep } from "./waitingSteps";

export const autoscaling: Tutorial = {
  id: "autoscaling",
  version: 1,
  track: "waiting",
  level: 3,
  minutes: 5,
  title: msg("tutorials.autoscaling.title"),
  summary: msg("tutorials.autoscaling.summary"),
  start: { example: "scale-on-busy-threads" },
  subjects: { caller: { stencils: ["generic.service"] } },
  steps: [
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
        { click: "inspector-section-node-simulation" },
        { click: "autoscaling-advanced-toggle" },
        { select: "autoscaling-metric", value: "busyThreads" },
      ],
      {
        title: msg("tutorials.autoscaling.scaleTitle"),
        goal: msg("tutorials.autoscaling.scaleGoal"),
        done: msg("tutorials.autoscaling.scaleDone"),
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
        goal: msg("tutorials.autoscaling.growGoal"),
        done: msg("tutorials.autoscaling.growDone"),
      },
    ),
  ],
  finish: { text: msg("tutorials.autoscaling.finish") },
};
