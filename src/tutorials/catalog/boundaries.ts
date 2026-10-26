import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
const nameGoalWords = () => t("tutorials.boundaries.nameGoal", { name: msg("tutorials.boundaries.boundaryName")() });
const nameTipWords = () => t("tutorials.boundaries.nameTip", { name: msg("tutorials.boundaries.boundaryName")() });

export const boundaries: Tutorial = {
  id: "boundaries",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 3,
  title: msg("tutorials.boundaries.title"),
  summary: msg("tutorials.boundaries.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.boundaries.diagramTitle"),
    nodes: [
      { id: "seed-0", stencil: "generic.service", label: t("tutorials.boundaries.service1"), x: 0, y: 200 },
      { id: "seed-1", stencil: "generic.service", label: t("tutorials.boundaries.service2"), x: 600, y: 200 },
      { id: "seed-2", stencil: "generic.service", label: t("tutorials.boundaries.service3"), x: 1100, y: 200 },
    ],
    edges: [],
  }),
  subjects: {
    a: { role: "processor" },
    b: { role: "processor" },
    c: { role: "processor" },
    boundary: { boundary: true },
  },
  steps: [
    {
      id: "select",
      title: msg("tutorials.boundaries.selectTitle"),
      goal: msg("tutorials.boundaries.selectGoal"),
      done: msg("tutorials.boundaries.selectDone"),
      check: { kind: "selection", subjects: ["a", "b"] },
      targets: [
        { testId: "node-{a}", tip: msg("tutorials.boundaries.selectTip") },
        { testId: "node-{b}", tip: msg("tutorials.boundaries.selectTip") },
      ],
      demo: [{ kind: "select", subjects: ["a", "b"] }],
      solution: [{ click: "node-{a}" }, { modClick: "node-{b}", modifiers: ["Shift"] }],
      sticky: true,
    },
    {
      id: "group",
      title: msg("tutorials.boundaries.groupTitle"),
      goal: msg("tutorials.boundaries.groupGoal"),
      done: msg("tutorials.boundaries.groupDone"),
      check: {
        kind: "all",
        checks: [
          { kind: "member", subject: "a", boundary: "boundary" },
          { kind: "member", subject: "b", boundary: "boundary" },
        ],
      },
      targets: [{ testId: "node-{a}", tip: msg("tutorials.boundaries.groupTip") }],
      demo: [{ kind: "group", subjects: ["a", "b"], boundary: "boundary" }],
      solution: [{ press: "ControlOrMeta+g" }],
    },
    {
      id: "name",
      title: msg("tutorials.boundaries.nameTitle"),
      goal: nameGoalWords,
      done: msg("tutorials.boundaries.nameDone"),
      check: { kind: "label", subject: "boundary", is: msg("tutorials.boundaries.boundaryName") },
      targets: [
        { testId: "inspector-field-label", tip: nameTipWords },
        { testId: "group-label-{boundary}", tip: nameTipWords },
      ],
      demo: [{ kind: "rename", subject: "boundary", label: msg("tutorials.boundaries.boundaryName") }],
      solution: [
        { dblclick: "group-label-{boundary}" },
        { fill: "inspector-field-label", text: msg("tutorials.boundaries.boundaryName") },
        { press: "Enter" },
      ],
      settle: "naming",
    },
    {
      id: "drag-in",
      title: msg("tutorials.boundaries.dragInTitle"),
      goal: msg("tutorials.boundaries.dragInGoal"),
      done: msg("tutorials.boundaries.dragInDone"),
      check: { kind: "member", subject: "c", boundary: "boundary" },
      targets: [{ testId: "node-{c}", tip: msg("tutorials.boundaries.dragInTip") }],
      demo: [{ kind: "member", subject: "c", boundary: "boundary" }],
      solution: [{ drag: "node-{c}", to: "group-{boundary}" }],
    },
    {
      id: "fit",
      title: msg("tutorials.boundaries.fitTitle"),
      goal: msg("tutorials.boundaries.fitGoal"),
      done: msg("tutorials.boundaries.fitDone"),
      check: { kind: "acknowledge" },
      targets: [{ testId: "group-label-{boundary}", tip: msg("tutorials.boundaries.fitTip") }],
      demo: [],
      solution: [
        { rightclick: "group-label-{boundary}" },
        { click: "context-menu-item-group.fit" },
        { click: "tutorial-skip" },
      ],
      sticky: true,
    },
  ],
  finish: { text: msg("tutorials.boundaries.finish") },
};
