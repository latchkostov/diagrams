import { msg, t } from "../../i18n";
import type { Tutorial } from "../types";
const path = (tool: string) => ({ annotate: t("menu.annotate"), tool, escape: t("keys.escape") });
export const annotate: Tutorial = {
  id: "annotate",
  version: 2,
  track: "basics",
  level: 1,
  minutes: 3,
  title: msg("tutorials.annotate.title"),
  summary: msg("tutorials.annotate.summaryV2"),
  start: () => ({ format: "diagrams/v1", title: t("tutorials.annotate.diagramTitle"), nodes: [], edges: [] }),
  subjects: {},
  steps: [
    {
      id: "title",
      title: msg("tutorials.annotate.titleTitle"),
      goal: () => t("tutorials.annotate.titleGoalV2", path(t("library.text"))),
      done: msg("tutorials.annotate.titleDone"),
      check: { kind: "annotation", annotation: "text" },
      settle: "annotation",
      targets: [
        { testId: "rail-annotate", tip: msg("menu.annotate") },
        { testId: "palette-annotate-text", tip: () => t("tutorials.annotate.titleTip", path(t("library.text"))) },
      ],
      demo: [{ kind: "annotate", annotation: "text" }],
      solution: [
        { click: "rail-annotate" },
        { click: "palette-annotate-text" },
        { fill: "annotation-editor", text: msg("tutorials.annotate.titleText") },
        { press: "Escape" },
      ],
    },
    {
      id: "note",
      title: msg("tutorials.annotate.noteTitle"),
      goal: () => t("tutorials.annotate.noteGoalV2", path(t("library.note"))),
      done: msg("tutorials.annotate.noteDone"),
      check: { kind: "annotation", annotation: "note" },
      settle: "annotation",
      targets: [
        { testId: "rail-annotate", tip: msg("menu.annotate") },
        { testId: "palette-annotate-note", tip: () => t("tutorials.annotate.noteTip", path(t("library.note"))) },
      ],
      demo: [{ kind: "annotate", annotation: "note" }],
      solution: [
        { click: "rail-annotate" },
        { click: "palette-annotate-note" },
        { fill: "annotation-editor", text: msg("tutorials.annotate.noteText") },
        { press: "Escape" },
      ],
    },
    {
      id: "zone",
      hint: msg("tutorials.annotate.zoneHint"),
      title: msg("tutorials.annotate.zoneTitle"),
      goal: () => t("tutorials.annotate.zoneGoalV2", path(t("library.zone"))),
      done: msg("tutorials.annotate.zoneDone"),
      check: { kind: "annotation", annotation: "zone" },
      settle: "annotation",
      targets: [
        { testId: "rail-annotate", tip: msg("menu.annotate") },
        { testId: "palette-annotate-zone", tip: () => t("tutorials.annotate.zoneTip", path(t("library.zone"))) },
      ],
      demo: [{ kind: "annotate", annotation: "zone" }],
      solution: [
        { click: "rail-annotate" },
        { click: "palette-annotate-zone" },
        { fill: "annotation-editor", text: msg("tutorials.annotate.zoneText") },
        { press: "Escape" },
      ],
    },
  ],
  finish: { text: msg("tutorials.annotate.finishV2") },
};
