import { msg, t } from "../../i18n";
import type { Tutorial, TutorialStep } from "../types";
const milestones = ["join", "edit", "watch", "leave"] as const;
const titles = [
  msg("tutorials.workTogether.joinTitle"),
  msg("tutorials.workTogether.editTitle"),
  msg("tutorials.workTogether.watchTitle"),
  msg("tutorials.workTogether.leaveTitle"),
];
const goals = [
  msg("tutorials.workTogether.joinGoal"),
  msg("tutorials.workTogether.editGoal"),
  msg("tutorials.workTogether.watchGoal"),
  msg("tutorials.workTogether.leaveGoal"),
];
const feedback = [
  msg("tutorials.workTogether.joinDone"),
  msg("tutorials.workTogether.editDone"),
  msg("tutorials.workTogether.watchDone"),
  msg("tutorials.workTogether.leaveDone"),
];
export const workTogether: Tutorial = {
  id: "work-together",
  version: 1,
  track: "sharing",
  optional: "collaboration",
  level: 1,
  minutes: 5,
  title: msg("tutorials.workTogether.title"),
  summary: msg("tutorials.workTogether.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.workTogether.title"),
    nodes: [
      {
        id: "api",
        stencil: "generic.webhook",
        label: t("tutorials.workTogether.api"),
        x: 0,
        y: 0,
        props: { ratePerSec: 4 },
      },
      { id: "worker", stencil: "service.go", label: t("tutorials.workTogether.worker"), x: 320, y: 0 },
    ],
    edges: [{ id: "flow", from: "api", to: "worker", kind: "async" }],
    simulations: [
      {
        id: "status-checks",
        title: t("tutorials.workTogether.run"),
        seed: 6,
        durationMs: 8000,
        traffic: [{ id: "status", node: "api", shape: { kind: "constant", ratePerSec: 4, durationMs: 8000 } }],
      },
    ],
  }),
  subjects: { worker: { stencils: ["service.go"] } },
  steps: [
    ...milestones.map((action, i): TutorialStep => ({
      id: action,
      title: titles[i],
      goal: goals[i],
      done: feedback[i],
      sticky: true,
      check: { kind: "localPeer", action },
      targets: [{ testId: `tutorial-peer-${action}`, tip: titles[i] }],
      demo: [{ kind: "localPeer", action }],
      solution: [{ click: `tutorial-peer-${action}` }],
    })),
    {
      id: "recovery",
      title: msg("tutorials.workTogether.leaveTitle"),
      goal: msg("tutorials.workTogether.leaveGoal"),
      done: msg("tutorials.workTogether.leaveDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "tutorial-peer-recovery", tip: msg("tutorials.workTogether.leaveTitle") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.workTogether.finish") },
};
