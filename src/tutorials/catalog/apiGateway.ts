import { stencilSearch } from "./searchValues";
import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
import { connectedStep, liveStep, practiceRun } from "./buildingBlocks";

const addOrdersGoalWords = () =>
  t("tutorials.apiGateway.addOrdersGoal", { name: msg("tutorials.apiGateway.ordersName")() });
const addUsersGoalWords = () =>
  t("tutorials.apiGateway.addUsersGoal", { name: msg("tutorials.apiGateway.usersName")() });

const addAppGoalWords = () => t("tutorials.apiGateway.addAppGoal", { query: stencilSearch("client.mobile")() });

export const apiGateway: Tutorial = {
  id: "api-gateway",
  version: 1,
  track: "blocks",
  level: 1,
  minutes: 4,
  title: msg("tutorials.apiGateway.title"),
  summary: msg("tutorials.apiGateway.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.apiGateway.title"),
    nodes: [],
    edges: [],
    simulations: [practiceRun(msg("tutorials.apiGateway.runName"))],
  }),
  subjects: {
    app: { stencils: ["client.mobile"] },
    gw: { stencils: ["kong"] },
    orders: { stencils: ["generic.service"], role: "processor" },
    users: { stencils: ["generic.service"], role: "processor" },
  },
  steps: [
    {
      id: "add-app",
      title: msg("tutorials.apiGateway.addAppTitle"),
      goal: addAppGoalWords,
      done: msg("tutorials.apiGateway.addAppDone"),
      check: { kind: "node", subject: "app" },
      targets: [
        { testId: "palette-search", tip: addAppGoalWords },
        { testId: "palette-item-client.mobile", tip: addAppGoalWords },
      ],
      demo: [{ kind: "add", subject: "app", stencil: "client.mobile" }],
      solution: [
        { fill: "palette-search", text: stencilSearch("client.mobile") },
        { click: "palette-item-client.mobile" },
      ],
    },
    connectedStep({
      hint: msg("tutorials.apiGateway.addHint"),
      id: "add-gw",
      from: "app",
      subject: "gw",
      stencil: "kong",
      search: stencilSearch("kong"),
      title: msg("tutorials.apiGateway.addGwTitle"),
      goal: msg("tutorials.apiGateway.addGwGoal"),
      done: msg("tutorials.apiGateway.addGwDone"),
    }),
    connectedStep({
      hint: msg("tutorials.apiGateway.addHint"),
      id: "add-orders",
      from: "gw",
      subject: "orders",
      stencil: "generic.service",
      search: stencilSearch("generic.service"),
      name: msg("tutorials.apiGateway.ordersName"),
      title: msg("tutorials.apiGateway.addOrdersTitle"),
      goal: addOrdersGoalWords,
      done: msg("tutorials.apiGateway.addOrdersDone"),
    }),
    connectedStep({
      hint: msg("tutorials.apiGateway.addHint"),
      id: "add-users",
      from: "gw",
      subject: "users",
      stencil: "generic.service",
      search: stencilSearch("generic.service"),
      name: msg("tutorials.apiGateway.usersName"),
      title: msg("tutorials.apiGateway.addUsersTitle"),
      goal: addUsersGoalWords,
      done: msg("tutorials.apiGateway.addUsersDone"),
    }),
    liveStep(
      msg("tutorials.apiGateway.liveTitle"),
      msg("tutorials.apiGateway.liveGoal"),
      msg("tutorials.apiGateway.liveDone"),
    ),
    {
      id: "watch",
      title: msg("tutorials.apiGateway.watchTitle"),
      goal: msg("tutorials.apiGateway.watchGoal"),
      done: msg("tutorials.apiGateway.watchDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "tutorial-flow" },
          { kind: "metric", subject: "orders", field: "processed", op: ">=", value: 5 },
          { kind: "metric", subject: "users", field: "processed", op: ">=", value: 5 },
        ],
      },
      sticky: true,
      targets: [{ testId: "node-{gw}", tip: msg("tutorials.apiGateway.watchGoal"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{gw}" }],
    },
  ],
  finish: {
    text: msg("tutorials.apiGateway.finish"),
    example: { slug: "api-route-table", label: msg("tutorials.apiGateway.example") },
  },
};
