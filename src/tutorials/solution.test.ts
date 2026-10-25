import { expect, it } from "vitest";
import { mobileApi } from "./catalog/mobileApi";
import { runnerInitial } from "./machine";
import { solutionNow } from "./solution";
import type { Tutorial } from "./types";

it("resolves contextual clicks, canvas gestures, translated typing and modified keys", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        solution: [
          { pane: "dblclick" },
          { rightclick: "edge-{call}" },
          { type: () => "gateway" },
          { select: "live-sim-picker", value: "steady-orders" },
          { press: "Alt+ArrowRight" },
        ],
      },
    ],
  };
  const snap = {
    state: { ...runnerInitial([false], { highlights: true, resumeAt: 0 }), value: "active" as const },
    subjects: { call: "generated-edge" },
    selected: [],
    announcement: "",
    nearMiss: null,
  };
  expect(solutionNow(tutorial, snap)).toEqual([
    { pane: "dblclick" },
    { rightclick: "edge-generated-edge" },
    { type: "gateway" },
    { select: "live-sim-picker", value: "steady-orders" },
    { press: "Alt+ArrowRight" },
  ]);
  expect(() => solutionNow(tutorial, { ...snap, subjects: {} })).toThrow("isn't in the sandbox");
  expect(solutionNow(tutorial, { ...snap, state: { ...snap.state, value: "finished" } })).toEqual([]);
});
