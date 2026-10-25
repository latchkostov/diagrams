import type { Simulation } from "../../model/types";
import type { UiStep, Words } from "../types";

/** Same seed and real units for every attempt at a milestone. */
export const studyRun = (id: string, title: Words): Simulation => ({
  id,
  title: title(),
  seed: 20261025,
  scale: 1,
  durationMs: 12_000,
  traffic: [],
});

/** Search explicitly: a milestone can build several different things without guiding the learner's quick-add. */
export const studyAdd = (from: string | null, search: Words): UiStep[] => [
  ...(from
    ? [{ click: `node-{${from}}` }, { click: "fit-view-button" }, { click: `grow-chip-{${from}}` }]
    : [{ press: "Alt+ArrowRight" }]),
  { fill: "quick-add-search", text: search },
  { press: "Enter" },
  { press: "Enter" },
];
