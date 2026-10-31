import { msg, t } from "../../i18n";
import type { DiagramFile } from "../../model/types";
import { withSavedSimulation } from "../simulations";
import type { Demo, Tutorial } from "../types";

export const savedSimulations: Tutorial = {
  id: "saved-simulations",
  version: 3,
  track: "simulation",
  level: 1,
  minutes: 3,
  title: msg("tutorials.savedSimulations.title"),
  summary: msg("tutorials.savedSimulations.summaryV2"),
  start: () => {
    const saveSimulation: Extract<Demo, { kind: "saveSimulation" }> = {
      kind: "saveSimulation",
      id: "three-quick-retries",
      title: msg("tutorials.savedSimulations.runName"),
      expectations: [
        {
          id: "goodput",
          label: t("tutorials.savedSimulations.expectationLabelV2", { client: t("tutorials.loadShedding.clientName") }),
          metric: { node: "client", field: "goodput" },
          op: ">=",
          value: 1,
          when: "end",
        },
      ],
    };

    const diagram: DiagramFile = {
      format: "diagrams/v2",
      planning: { revision: "p3-w2" },
      title: t("tutorials.savedSimulations.title"),
      nodes: [
        {
          id: "client",
          stencil: "client.mobile",
          label: t("tutorials.loadShedding.clientName"),
          x: 0,
          y: 0,
          props: { ratePerSec: 0 },
        },
        {
          id: "checkout",
          stencil: "generic.service",
          label: t("tutorials.savedSimulations.checkoutName"),
          x: 300,
          y: 0,
          props: { latencyMs: 20, jitter: 0 },
        },
        {
          id: "payments",
          stencil: "postgres",
          label: t("tutorials.savedSimulations.paymentsName"),
          x: 600,
          y: 0,
          props: { latencyMs: 40, jitter: 0 },
        },
      ],
      edges: [
        { id: "request", from: "client", to: "checkout", kind: "sync", props: { travelMs: 10 } },
        {
          id: "pay",
          from: "checkout",
          to: "payments",
          kind: "sync",
          props: {
            travelMs: 10,
            caller: { retry: { maxAttempts: 3, backoffMs: 100, strategy: "fixed", retryOn: ["transient", "timeout"] } },
          },
        },
      ],
      simulations: [
        {
          id: saveSimulation.id,
          title: saveSimulation.title(),
          seed: 7,
          scale: 1,
          durationMs: 6000,
          traffic: [{ id: "orders", node: "client", shape: { kind: "constant", ratePerSec: 10, durationMs: 4000 } }],
          timeline: [
            { atMs: 1000, action: { do: "fault", fault: { kind: "fail", node: "payments", rate: 0.5 } } },
            {
              atMs: 1200,
              action: {
                do: "note",
                text: t("tutorials.savedSimulations.pauseNote"),
                focus: ["checkout", "payments"],
                pause: true,
              },
            },
            { atMs: 2000, action: { do: "fault", fault: { kind: "fail", node: "payments", rate: 0 } } },
          ],
        },
      ],
    };
    return { ...diagram, simulations: withSavedSimulation(diagram, saveSimulation)! };
  },
  subjects: { checkout: { stencils: ["generic.service"] } },
  steps: [
    {
      id: "live",
      title: msg("tutorials.savedSimulations.liveTitle"),
      goal: msg("tutorials.savedSimulations.liveGoal"),
      done: msg("tutorials.savedSimulations.liveDone"),
      check: { kind: "simulation", id: "three-quick-retries" },
      targets: [
        { testId: "live-sim-picker", tip: msg("tutorials.savedSimulations.liveGoal") },
        { testId: "live-toggle", tip: msg("tutorials.savedSimulations.liveGoal") },
      ],
      demo: [{ kind: "runSimulation", id: "three-quick-retries" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "three-quick-retries" }],
    },
    {
      id: "waiting",
      title: msg("tutorials.savedSimulations.waitingTitle"),
      goal: msg("tutorials.savedSimulations.waitingGoal"),
      done: msg("tutorials.savedSimulations.waitingDone"),
      check: { kind: "note", waiting: true },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.savedSimulations.waitingGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "live-note-continue" }],
    },
    {
      id: "continue",
      title: msg("tutorials.savedSimulations.continueTitle"),
      goal: msg("tutorials.savedSimulations.continueGoal"),
      done: msg("tutorials.savedSimulations.continueDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "three-quick-retries", atLeastMs: 1200 },
          { kind: "note", waiting: false },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: msg("tutorials.savedSimulations.continueGoal"), dim: false }],
      demo: [{ kind: "continueNote", simulation: "three-quick-retries", atLeastMs: 1200 }],
      solution: [{ click: "live-note-continue" }],
    },
    {
      id: "expectation",
      title: msg("tutorials.savedSimulations.expectationTitle"),
      goal: () => t("tutorials.savedSimulations.expectationGoalV2", { client: t("tutorials.loadShedding.clientName") }),
      done: msg("tutorials.savedSimulations.expectationDoneV2"),
      // eslint-disable-next-line local/no-literal-ui-text -- Stable saved expectation id, never displayed copy.
      check: { kind: "expectation", simulation: "three-quick-retries", label: "goodput", outcome: "either" },
      sticky: true,
      targets: [
        {
          testId: "live-speed",
          tip: () =>
            t("tutorials.savedSimulations.expectationGoalV2", { client: t("tutorials.loadShedding.clientName") }),
          dim: false,
        },
      ],
      demo: [],
      solution: [{ select: "live-speed", value: "8" }],
    },
  ],
  finish: { text: msg("tutorials.savedSimulations.finishV2") },
};
