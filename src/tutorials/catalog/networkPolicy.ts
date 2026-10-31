import { msg, t } from "../../i18n";
import { policyPractice } from "../../lab/buildingBlockSeeds";
import type { Tutorial } from "../types";
export const networkPolicy: Tutorial = {
  id: "network-policy",
  version: 1,
  track: "blocks",
  level: 2,
  minutes: 4,
  title: msg("tutorials.networkPolicy.title"),
  summary: msg("tutorials.networkPolicy.summary"),
  start: policyPractice,
  subjects: {
    browser: { stencils: ["client.browser"] },
    probe: { stencils: ["client.team"] },
    fw: { stencils: ["paloalto.ngfw"] },
    api: { stencils: ["service.dotnet"] },
    admin: { stencils: ["service.go"] },
  },
  steps: [
    {
      id: "predict",
      title: msg("tutorials.networkPolicy.predictTitle"),
      goal: () => t("tutorials.networkPolicy.predictGoal", { web: "WebRequest", probe: "AdminProbe" }),
      done: () => t("tutorials.networkPolicy.predictDone", { probe: "AdminProbe" }),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{admin}", tip: msg("tutorials.networkPolicy.predictTitle") }],
      demo: [],
      solution: [{ click: "node-{admin}" }, { press: "Control+Alt+[" }, { click: "tutorial-skip" }],
    },
    {
      id: "observe",
      title: msg("tutorials.networkPolicy.observeTitle"),
      goal: () =>
        t("tutorials.networkPolicy.observeGoal", {
          policy: t("stencil.genericFirewallName"),
          traffic: t("tutorials.networkPolicy.traffic"),
          api: t("tutorials.networkPolicy.api"),
          admin: t("tutorials.networkPolicy.admin"),
          probe: "AdminProbe",
        }),
      done: msg("tutorials.networkPolicy.observeDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "policy-traffic" },
          { kind: "processed", subject: "api", atLeast: 5 },
          { kind: "metric", subject: "fw", field: "blocked", op: ">=", value: 1 },
          { kind: "metric", subject: "fw", field: "failed", op: "=", value: 0 },
          { kind: "metric", subject: "fw", field: "dropped", op: "=", value: 0 },
          { kind: "metric", subject: "admin", field: "processed", op: "=", value: 0 },
          { kind: "readout", subject: "fw" },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-controls", tip: msg("tutorials.networkPolicy.observeTitle") }],
      demo: [],
      solution: [
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "policy-traffic" },
        { hover: "node-{fw}" },
      ],
    },
    {
      id: "allow",
      title: msg("tutorials.networkPolicy.allowTitle"),
      goal: () =>
        t("tutorials.networkPolicy.allowGoal", { probe: "AdminProbe", admin: t("tutorials.networkPolicy.admin") }),
      done: () => t("tutorials.networkPolicy.allowDone", { probe: "AdminProbe" }),
      check: {
        kind: "all",
        checks: [
          { kind: "prop", edge: ["fw", "admin"], prop: "deny", op: "falsy" },
          { kind: "prop", edge: ["fw", "admin"], prop: "filter", op: "=", value: ["AdminProbe"] },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{admin}", tip: msg("tutorials.networkPolicy.allowTitle") }],
      demo: [{ kind: "prop", edge: ["fw", "admin"], props: { deny: false } }],
      solution: [{ click: "node-{admin}" }, { press: "Control+Alt+[" }, { click: "inspector-field-rule-allow" }],
    },
    {
      id: "replay",
      title: msg("tutorials.networkPolicy.replayTitle"),
      goal: () =>
        t("tutorials.networkPolicy.replayGoal", {
          traffic: t("tutorials.networkPolicy.traffic"),
          admin: t("tutorials.networkPolicy.admin"),
        }),
      done: () => t("tutorials.networkPolicy.replayDone", { admin: t("tutorials.networkPolicy.admin") }),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "policy-traffic" },
          { kind: "compare", left: { sinceStep: { node: "admin", metric: "processed" } }, op: ">=", right: 5 },
          { kind: "selection", subjects: ["admin"], exact: true },
          { kind: "dock", tab: "properties" },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-controls", tip: msg("tutorials.networkPolicy.replayTitle") }],
      demo: [],
      solution: [{ click: "live-restart" }, { dblclick: "node-{admin}" }],
    },
    {
      id: "read",
      title: msg("tutorials.networkPolicy.readTitle"),
      goal: msg("tutorials.networkPolicy.readGoal"),
      done: msg("tutorials.networkPolicy.readDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "live-controls", tip: msg("tutorials.networkPolicy.readTitle") }],
      demo: [],
      solution: [{ click: "tutorial-skip" }],
    },
  ],
  finish: {
    text: () => t("tutorials.networkPolicy.finish", { admin: t("tutorials.networkPolicy.admin") }),
    example: { slug: "contoso-dmz", label: msg("tutorials.networkPolicy.title") },
  },
};
