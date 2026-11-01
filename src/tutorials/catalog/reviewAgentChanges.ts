/* eslint-disable local/no-literal-ui-text -- Status API and worker labels are authored public fixture data. */
import { msg, t } from "../../i18n";
import type { Check, Tutorial, TutorialStep, UiStep, Words } from "../types";
import { workerReply, renameReply } from "./agentReplies";
const apply = (reply: string): UiStep[] => [
  { open: "ai-advanced-toggle" },
  { fill: "ai-reply", text: reply },
  { click: "ai-apply" },
];
const turn = (
  id: string,
  title: Words,
  goal: Words,
  done: Words,
  action: "add" | "rename" | "undo" | "revert",
  check: Check,
  solution: UiStep[],
  reply?: string,
): TutorialStep => ({
  id,
  title,
  goal,
  done,
  check,
  sticky: true,
  targets: [
    {
      testId: action === "undo" ? "ai-turn-0-undo" : action === "revert" ? "ai-turn-1-revert" : "ai-reply",
      tip: title,
    },
    ...(reply ? [{ testId: "ai-advanced-toggle", tip: title }] : []),
  ],
  demo: [{ kind: "agentFixture", action }],
  solution,
  ...(reply
    ? {
        note: {
          title: action === "rename" ? msg("tutorials.agentReview.reply2") : msg("tutorials.agentReview.reply1"),
          text: reply,
          code: true as const,
        },
      }
    : {}),
});
const worker: Check = {
  kind: "all",
  checks: [
    { kind: "aiTurn", turn: "change", subject: "worker" },
    { kind: "node", subject: "worker" },
    { kind: "edge", from: "api", to: "worker" },
  ],
};
export const reviewAgentChanges: Tutorial = {
  id: "review-agent-changes",
  version: 1,
  track: "sharing",
  optional: "ai",
  level: 1,
  minutes: 4,
  title: msg("tutorials.agentReview.title"),
  summary: msg("tutorials.agentReview.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.agentReview.title"),
    nodes: [{ id: "api", stencil: "generic.webhook", label: "Status API", x: 0, y: 0 }],
    edges: [],
  }),
  subjects: { api: { stencils: ["generic.webhook"] }, worker: { stencils: ["service.go"], downstreamOf: "api" } },
  steps: [
    {
      id: "open",
      title: msg("tutorials.agentReview.openTitle"),
      goal: msg("tutorials.agentReview.openGoal"),
      done: msg("tutorials.agentReview.openDone"),
      check: { kind: "dock", tab: "ai" },
      sticky: true,
      targets: [
        { testId: "ai-rail-open", tip: msg("tutorials.agentReview.openTitle") },
        { testId: "rail-more", tip: msg("tutorials.agentReview.openTitle") },
        { testId: "ai-panel", tip: msg("tutorials.agentReview.openTitle") },
      ],
      demo: [{ kind: "aiDock" }],
      solution: [{ click: "ai-rail-open" }],
    },
    {
      id: "read",
      title: msg("tutorials.agentReview.openTitle"),
      goal: msg("tutorials.agentReview.openGoal"),
      done: msg("tutorials.agentReview.openDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "ai-panel", tip: msg("tutorials.agentReview.openTitle") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
    {
      id: "context",
      title: msg("tutorials.agentReview.contextTitle"),
      goal: msg("tutorials.agentReview.contextGoal"),
      done: msg("tutorials.agentReview.contextDone"),
      sticky: true,
      check: { kind: "aiTurn", turn: "context", subject: "api" },
      targets: [
        { testId: "ai-copy-prompt", tip: msg("tutorials.agentReview.contextTitle") },
        { testId: "ai-advanced-toggle", tip: msg("tutorials.agentReview.contextTitle") },
      ],
      demo: [{ kind: "copyAiContext", subject: "api" }],
      solution: [
        { click: "node-{api}" },
        { click: "ai-rail-open" },
        { open: "ai-advanced-toggle" },
        { click: "ai-copy-prompt" },
      ],
    },
    turn(
      "apply",
      msg("tutorials.agentReview.applyTitle"),
      msg("tutorials.agentReview.applyGoal"),
      msg("tutorials.agentReview.applyDone"),
      "add",
      worker,
      apply(workerReply),
      workerReply,
    ),
    turn(
      "undo",
      msg("tutorials.agentReview.undoTitle"),
      msg("tutorials.agentReview.undoGoal"),
      msg("tutorials.agentReview.undoDone"),
      "undo",
      // Apply may update a learner's existing worker. Genuine Undo evidence covers both inverses.
      { kind: "aiTurn", turn: "undo" },
      [{ click: "ai-turn-0-undo" }],
    ),
    turn(
      "again",
      msg("tutorials.agentReview.againTitle"),
      msg("tutorials.agentReview.againGoal"),
      msg("tutorials.agentReview.againDone"),
      "add",
      worker,
      apply(workerReply),
      workerReply,
    ),
    turn(
      "rename",
      msg("tutorials.agentReview.renameTitle"),
      () => t("tutorials.agentReview.renameGoal", { name: "Unreviewed worker" }),
      msg("tutorials.agentReview.renameDone"),
      "rename",
      {
        kind: "all",
        checks: [{ kind: "aiTurn", turn: "change", subject: "worker", label: () => "Unreviewed worker" }],
      },
      apply(renameReply),
      renameReply,
    ),
    turn(
      "revert",
      msg("tutorials.agentReview.revertTitle"),
      () => t("tutorials.agentReview.revertGoal", { name: "Status worker" }),
      msg("tutorials.agentReview.revertDone"),
      "revert",
      {
        kind: "all",
        checks: [
          { kind: "aiTurn", turn: "revert", subject: "worker", label: () => "Status worker" },
          { kind: "edge", from: "api", to: "worker" },
        ],
      },
      [{ click: "ai-turn-1-revert" }],
    ),
    {
      id: "limits",
      title: msg("tutorials.agentReview.limitsTitle"),
      goal: msg("tutorials.agentReview.limitsGoal"),
      done: msg("tutorials.agentReview.limitsDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "ai-panel", tip: msg("tutorials.agentReview.openTitle") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
  ],
  finish: { text: msg("tutorials.agentReview.finish") },
};
