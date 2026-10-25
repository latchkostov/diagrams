/* eslint-disable local/no-literal-ui-text -- Solution text in these fixtures is test input, not UI copy. */
import { expect, it } from "vitest";
import { mobileApi } from "./catalog/mobileApi";
import { runnerInitial } from "./machine";
import type { RunnerSnapshot } from "./runner";
import { solutionNow } from "./solution";
import type { Tutorial } from "./types";

it("resolves subjects in modified clicks, context clicks and selection boxes", () => {
  const tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        solution: [
          { modClick: "node-{api}", modifiers: ["Shift"] },
          { rightclick: "node-{api}" },
          { boxSelect: "canvas-pane", around: ["node-{app}", "node-{api}"] },
        ] as const,
      },
    ],
  };
  const snap: RunnerSnapshot = {
    state: { ...runnerInitial([false], { highlights: true, resumeAt: 0 }), value: "active" },
    subjects: { app: "one", api: "two" },
    selected: [],
    announcement: "",
    nearMiss: null,
    edges: {},
  };
  expect(solutionNow(tutorial, snap)).toEqual([
    { modClick: "node-two", modifiers: ["Shift"] },
    { rightclick: "node-two" },
    { boxSelect: "canvas-pane", around: ["node-one", "node-two"] },
  ]);
  expect(() => solutionNow(tutorial, { ...snap, subjects: {} })).toThrow("isn't in the sandbox");
});

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
    edges: {},
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

it("resolves a connection between subjects and text typed at a focused field's caret", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        solution: [
          { click: "edge-label-{app->api}" },
          { press: "ControlOrMeta+End" },
          { type: "inspector-field-settings", text: () => "Token" },
          { type: "inspector-field-settings", text: "Literal" },
        ],
      },
    ],
  };
  const snap: RunnerSnapshot = {
    state: { ...runnerInitial([false], { highlights: true, resumeAt: 0 }), value: "active" },
    subjects: { app: "one", api: "two" },
    selected: [],
    announcement: "",
    nearMiss: null,
    // Its id in the sandbox, whatever an example saved it as.
    edges: { "app->api": "unrelated-id" },
  };
  expect(solutionNow(tutorial, snap)).toEqual([
    { click: "edge-label-unrelated-id" },
    { press: "ControlOrMeta+End" },
    { type: "Token", into: "inspector-field-settings" },
    { type: "Literal", into: "inspector-field-settings" },
  ]);
  // Not connected (yet, or the other way round): the step can't be played.
  expect(() => solutionNow(tutorial, { ...snap, edges: { "api->app": "x" } })).toThrow("isn't in the sandbox");
});
