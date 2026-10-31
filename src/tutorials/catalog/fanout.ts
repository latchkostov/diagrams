import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

const messageType = "OrderShipped";
const filterGoal = () => t("tutorials.fanout.filterGoal", { messageType });

export const fanout: Tutorial = {
  id: "fanout",
  version: 1,
  track: "blocks",
  level: 2,
  minutes: 3,
  title: msg("tutorials.fanout.title"),
  summary: msg("tutorials.fanout.summaryVerified"),
  start: { example: "notification-fanout" },
  subjects: {
    router: { stencils: ["azure.functions"] },
    emailQueue: { stencils: ["azure.service-bus.queue"] },
    smsQueue: { stencils: ["azure.service-bus.queue"] },
  },
  steps: [
    {
      id: "run-sms-outage",
      title: msg("tutorials.fanout.runTitle"),
      goal: msg("tutorials.fanout.runGoal"),
      done: msg("tutorials.fanout.runDone"),
      check: { kind: "simulation", id: "sms-outage" },
      sticky: true,
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.fanout.runGoal") },
        { testId: "live-toggle", tip: msg("tutorials.fanout.runGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "sms-outage" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "sms-outage" }],
    },
    {
      id: "watch-sms-backlog",
      title: msg("tutorials.fanout.watchTitle"),
      goal: msg("tutorials.fanout.watchGoal"),
      done: msg("tutorials.fanout.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "sms-outage", atLeastMs: 1500 },
          { kind: "metric", subject: "smsQueue", field: "backlog", op: ">=", value: 1 },
          { kind: "note", waiting: false },
        ],
      },
      sticky: true,
      targets: [
        { testId: "live-note-continue", tip: msg("tutorials.fanout.watchGoal"), dim: false },
        { testId: "node-{smsQueue}", tip: msg("tutorials.fanout.watchGoal"), dim: false },
      ],
      demo: [],
      solution: [{ click: "live-note-continue" }],
    },
    {
      id: "filter-sms",
      title: msg("tutorials.fanout.filterTitle"),
      goal: filterGoal,
      done: msg("tutorials.fanout.filterDoneVerified"),
      check: { kind: "prop", edge: ["router", "smsQueue"], prop: "filter", op: "=", value: [messageType] },
      targets: [
        { testId: "inspector-filter-option-0", tip: filterGoal },
        { testId: "inspector-section-edge-messages", tip: filterGoal },
        { testId: "edge-label-{router->smsQueue}", tip: filterGoal },
      ],
      demo: [{ kind: "prop", edge: ["router", "smsQueue"], props: { filter: [messageType] } }],
      solution: [
        // Live preserves the camera: explicitly focus the router before editing its connection.
        { click: "node-{router}" },
        { press: "Shift+Digit2" },
        { dblclick: "edge-label-{router->smsQueue}" },
        { click: "inspector-section-edge-messages" },
        { click: "inspector-filter-option-0" },
      ],
    },
  ],
  finish: { text: msg("tutorials.fanout.finishVerified") },
};
