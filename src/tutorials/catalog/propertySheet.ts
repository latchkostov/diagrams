import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";

const nameGoalWords = () =>
  t("tutorials.propertySheet.nameGoal", { name: msg("tutorials.propertySheet.paymentsName")() });
const subtitleGoalWords = () =>
  t("tutorials.propertySheet.subtitleGoal", { name: msg("tutorials.propertySheet.subtitleValue")() });

export const propertySheet: Tutorial = {
  id: "property-sheet",
  version: 1,
  track: "basics",
  level: 1,
  minutes: 2,
  title: msg("tutorials.propertySheet.title"),
  summary: msg("tutorials.propertySheet.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: t("tutorials.propertySheet.diagramTitle"),
    nodes: [{ id: "api", stencil: "generic.service", label: t("tutorials.propertySheet.apiName"), x: 0, y: 0 }],
    edges: [],
  }),
  subjects: { api: { role: "processor" } },
  steps: [
    {
      id: "open",
      title: msg("tutorials.propertySheet.openTitle"),
      goal: msg("tutorials.propertySheet.openGoal"),
      done: msg("tutorials.propertySheet.openDone"),
      check: { kind: "mode", value: "naming", subject: "api" },
      targets: [{ testId: "node-{api}", tip: msg("tutorials.propertySheet.openGoal") }],
      demo: [{ kind: "name", subject: "api" }],
      solution: [{ dblclick: "node-{api}" }],
      sticky: true,
    },
    {
      id: "name",
      title: msg("tutorials.propertySheet.nameTitle"),
      goal: nameGoalWords,
      done: msg("tutorials.propertySheet.nameDone"),
      check: { kind: "label", subject: "api", is: msg("tutorials.propertySheet.paymentsName") },
      targets: [{ testId: "inspector-field-label", tip: nameGoalWords }],
      demo: [{ kind: "rename", subject: "api", label: msg("tutorials.propertySheet.paymentsName") }],
      solution: [
        { fill: "inspector-field-label", text: msg("tutorials.propertySheet.paymentsName") },
        { press: "Enter" },
      ],
      settle: "naming",
    },
    {
      id: "subtitle",
      title: msg("tutorials.propertySheet.subtitleTitle"),
      goal: subtitleGoalWords,
      done: msg("tutorials.propertySheet.subtitleDone"),
      check: { kind: "field", subject: "api", field: "sublabel", is: msg("tutorials.propertySheet.subtitleValue") },
      targets: [{ testId: "inspector-field-sublabel", tip: subtitleGoalWords }],
      demo: [{ kind: "field", subject: "api", field: "sublabel", value: msg("tutorials.propertySheet.subtitleValue") }],
      solution: [
        { fill: "inspector-field-sublabel", text: msg("tutorials.propertySheet.subtitleValue") },
        { press: "Enter" },
      ],
    },
    {
      id: "description",
      title: msg("tutorials.propertySheet.descriptionTitle"),
      goal: msg("tutorials.propertySheet.descriptionGoal"),
      done: msg("tutorials.propertySheet.descriptionDone"),
      check: { kind: "field", subject: "api", field: "description" },
      targets: [{ testId: "inspector-field-node-description", tip: msg("tutorials.propertySheet.descriptionGoal") }],
      demo: [
        { kind: "field", subject: "api", field: "description", value: msg("tutorials.propertySheet.descriptionValue") },
      ],
      solution: [{ fill: "inspector-field-node-description", text: msg("tutorials.propertySheet.descriptionValue") }],
    },
  ],
  finish: { text: msg("tutorials.propertySheet.finish") },
};
