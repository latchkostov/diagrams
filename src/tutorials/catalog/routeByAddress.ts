import { msg, t } from "../../i18n";
import { addressPractice } from "../../lab/buildingBlockSeeds";
import type { Tutorial } from "../types";
export const routeByAddress: Tutorial = {
  id: "route-by-address",
  version: 1,
  track: "blocks",
  level: 2,
  minutes: 4,
  title: msg("tutorials.routeByAddress.title"),
  summary: msg("tutorials.routeByAddress.summary"),
  start: addressPractice,
  subjects: {
    app: { stencils: ["client.mobile"] },
    gw: { stencils: ["kong"] },
    orders: { stencils: ["service.go"] },
    users: { stencils: ["service.java"] },
  },
  steps: [
    {
      id: "inspect",
      title: msg("tutorials.routeByAddress.inspectTitle"),
      goal: msg("tutorials.routeByAddress.inspectGoal"),
      done: msg("tutorials.routeByAddress.inspectDone"),
      check: { kind: "acknowledge" },
      sticky: true,
      targets: [{ testId: "node-{app}", tip: msg("tutorials.routeByAddress.inspectTitle") }],
      demo: [],
      solution: [{ dblclick: "node-{app}" }, { click: "tutorial-skip" }],
    },
    {
      id: "route",
      title: () => t("tutorials.routeByAddress.routeTitle", { orders: t("tutorials.routeByAddress.ordersService") }),
      goal: () =>
        t("tutorials.routeByAddress.routeGoal", {
          orders: t("tutorials.routeByAddress.ordersService"),
          users: t("tutorials.routeByAddress.usersService"),
        }),
      done: () => t("tutorials.routeByAddress.routeDone", { orders: t("tutorials.routeByAddress.ordersService") }),
      check: {
        kind: "prop",
        subject: "gw",
        prop: ["routeTable", "rules", { where: { id: "parcels" } }, "targets"],
        op: "=",
        value: [{ edgeId: "to-tracking", weight: 1 }],
      },
      sticky: true,
      targets: [
        {
          testId: "node-{gw}",
          tip: () => t("tutorials.routeByAddress.routeTitle", { orders: t("tutorials.routeByAddress.ordersService") }),
        },
      ],
      demo: [
        {
          kind: "patch",
          subject: "gw",
          patches: [
            {
              op: "set",
              path: ["routeTable", "rules", { where: { id: "parcels" } }, "targets"],
              value: [{ edgeId: "to-tracking", weight: 1 }],
            },
          ],
        },
      ],
      solution: [
        { dblclick: "node-{gw}" },
        { click: "routes-rule-parcels" },
        { click: "routes-rule-parcels-targets-to-tracking" },
        { click: "routes-rule-parcels-targets-to-pricing" },
      ],
    },
    {
      id: "watch",
      title: msg("tutorials.routeByAddress.watchTitle"),
      goal: () =>
        t("tutorials.routeByAddress.watchGoal", {
          mix: t("tutorials.routeByAddress.mix"),
          orders: t("tutorials.routeByAddress.ordersService"),
        }),
      done: msg("tutorials.routeByAddress.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "address-mix" },
          { kind: "trace" },
          { kind: "routeEvidence", subject: "gw", route: "track-parcel", rule: "parcels", to: "orders" },
          { kind: "processed", subject: "orders", atLeast: 2 },
          { kind: "processed", subject: "users", atLeast: 2 },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-controls", tip: msg("tutorials.routeByAddress.watchTitle") }],
      demo: [{ kind: "runSimulation", id: "address-mix" }, { kind: "trace" }],
      solution: [
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "address-mix" },
        { rightclick: "node-{orders}" },
        { click: "context-menu-item-sim.trace-next" },
      ],
    },
    {
      id: "refuse",
      title: msg("tutorials.routeByAddress.refuseTitle"),
      goal: () => t("tutorials.routeByAddress.refuseGoal", { unknown: t("tutorials.routeByAddress.unknown") }),
      done: msg("tutorials.routeByAddress.refuseDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "unknown-address" },
          { kind: "routeEvidence", subject: "gw", route: "old-tracking", rejected: true, reason: "route-not-found" },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-controls", tip: msg("tutorials.routeByAddress.refuseTitle") }],
      demo: [{ kind: "runSimulation", id: "unknown-address" }],
      solution: [{ select: "live-sim-picker", value: "unknown-address" }, { hover: "node-{gw}" }],
    },
    {
      id: "default",
      title: msg("tutorials.routeByAddress.defaultTitle"),
      goal: () => t("tutorials.routeByAddress.defaultGoal", { orders: t("tutorials.routeByAddress.ordersService") }),
      done: msg("tutorials.routeByAddress.defaultDone"),
      check: {
        kind: "prop",
        subject: "gw",
        prop: ["routeTable", "default", "targets"],
        op: "=",
        value: [{ edgeId: "to-tracking", weight: 1 }],
      },
      sticky: true,
      targets: [{ testId: "node-{gw}", tip: msg("tutorials.routeByAddress.defaultTitle") }],
      demo: [
        {
          kind: "patch",
          subject: "gw",
          patches: [
            { op: "set", path: ["routeTable", "default"], value: { targets: [{ edgeId: "to-tracking", weight: 1 }] } },
          ],
        },
      ],
      keyboardSolution: [
        { command: "live:toggle", query: () => ">" },
        { press: "Escape" },
        { focus: "node-{gw}" },
        { press: "F2" },
        { activate: "routes-default" },
        { focus: "routes-default-reject" },
        { press: "ArrowDown" },
        { activate: "routes-default-targets-to-pricing" },
      ],
      solution: [
        { click: "live-toggle" },
        { press: "Escape" },
        { dblclick: "node-{gw}" },
        { click: "routes-default" },
        { click: "routes-default-forward" },
        { click: "routes-default-targets-to-pricing" },
      ],
    },
    {
      id: "replay",
      title: msg("tutorials.routeByAddress.replayTitle"),
      goal: () =>
        t("tutorials.routeByAddress.replayGoal", {
          unknown: t("tutorials.routeByAddress.unknown"),
          orders: t("tutorials.routeByAddress.ordersService"),
        }),
      done: () => t("tutorials.routeByAddress.replayDone", { orders: t("tutorials.routeByAddress.ordersService") }),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "unknown-address", atLeastMs: 1000 },
          { kind: "compare", left: { sinceStep: { node: "orders", metric: "processed" } }, op: ">=", right: 5 },
          { kind: "metric", subject: "gw", field: "rejected", op: "=", value: 0 },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-controls", tip: msg("tutorials.routeByAddress.replayTitle") }],
      demo: [{ kind: "runSimulation", id: "unknown-address" }],
      solution: [
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "unknown-address" },
        { hover: "node-{orders}" },
      ],
    },
  ],
  finish: {
    text: msg("tutorials.routeByAddress.finish"),
    example: { slug: "api-route-table", label: msg("tutorials.routeByAddress.title") },
  },
};
