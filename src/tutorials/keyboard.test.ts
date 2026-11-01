import { expect, it } from "vitest";
import { allTutorials } from "./catalog";
import { keyboardExceptions, keyboardSolutionNow, withKeyboardSolutions } from "./keyboard";
import { runnerInitial } from "./machine";
import { t } from "../i18n";

it("uses the registered Fit view command instead of traversing the chrome", () => {
  const lesson = allTutorials.find((lesson) => lesson.id === "study-fanout")!;
  const routed = withKeyboardSolutions({
    ...lesson,
    steps: [{ ...lesson.steps[0], solution: [{ click: "fit-view-button" }], keyboardSolution: undefined }],
  });
  const [fit] = routed.steps[0].keyboardSolution!;
  expect(routed.steps[0].keyboardSolution).toHaveLength(1);
  expect(fit).toMatchObject({ command: "action:canvas.fit" });
  expect("command" in fit && fit.query()).toBe(t("menu.fitView"));
});

it("every eligible lesson has a keyboard variant beside every pointer solution", () => {
  expect(Object.keys(keyboardExceptions)).toEqual(["boundaries", "arrange"]);
  for (const lesson of allTutorials) {
    for (const step of lesson.steps) {
      if (keyboardExceptions[lesson.id]) {
        expect(step.keyboardSolution).toBeUndefined();
        continue;
      }
      expect(step.keyboardSolution, `${lesson.id}/${step.id}`).toBeDefined();
      const acknowledgment = step.check.kind === "acknowledge";
      for (const action of step.keyboardSolution!) {
        expect(action).not.toHaveProperty("click");
        expect(action).not.toHaveProperty("hover");
        expect(action).not.toHaveProperty("drag");
        if ("activate" in action && action.activate === "tutorial-skip") expect(acknowledgment).toBe(true);
      }
    }
  }
});

it("resolves keyboard subjects and connection identities without executing a demo", () => {
  const lesson = allTutorials.find((lesson) => lesson.id === "dots-and-sides")!;
  const snapshot = {
    state: { ...runnerInitial([true, true, false], { highlights: true, resumeAt: 0 }), value: "active" as const },
    subjects: { app: "browser", a: "api", b: "other", link: "wire" },
    selected: [],
    announcement: "",
    nearMiss: null,
    edges: {},
  };
  expect(keyboardSolutionNow(lesson, snapshot)).toEqual([
    { connect: "node-browser", to: "node-api", side: undefined, fromSide: "right" },
  ]);
  expect(keyboardSolutionNow(lesson, { ...snapshot, state: { ...snapshot.state, index: 3 } })).toEqual([
    { activate: "edge-wire" },
    { reconnect: "edge-wire", to: "node-other" },
  ]);
  expect(() => keyboardSolutionNow(lesson, { ...snapshot, subjects: {} })).toThrow("Missing keyboard solution subject");
  expect(keyboardSolutionNow(lesson, { ...snapshot, state: { ...snapshot.state, value: "finished" } })).toEqual([]);
});

it("lets the final slow-motion replay finish without navigating away from it", () => {
  const lesson = allTutorials.find((lesson) => lesson.id === "trace-slowmo")!;
  const step = lesson.steps.find((step) => step.check.kind === "slowmo" && step.check.finished)!;
  expect(step.solution).toEqual([{ select: "live-speed", value: "8" }, { playing: true }]);
  expect(step.keyboardSolution).toEqual([{ choose: "live-speed", value: "8" }, { playing: true }]);
});

it("a semantic readout step has a keyboard read action, not just canvas focus", () => {
  const lesson = allTutorials.find((t) => t.id === "network-policy")!;
  expect(lesson.steps.find((s) => s.id === "observe")!.keyboardSolution).toContainEqual({ read: "node-{fw}" });
});

it("keeps authored keyboard routes for native radio groups", () => {
  const lesson = allTutorials.find((t) => t.id === "route-by-address")!;
  const step = lesson.steps.find((s) => s.id === "default")!;
  const route = step.keyboardSolution;
  expect(route).toContainEqual({ focus: "routes-default-reject" });
  expect(route).toContainEqual({ press: "ArrowDown" });
  expect(withKeyboardSolutions(lesson).steps.find((s) => s.id === "default")!.keyboardSolution).toBe(route);
});

it("uses an authored keyboard solution before translating unsupported pointer gestures", () => {
  const keyboardSolution = [{ press: "ControlOrMeta+a" }];
  const lesson = allTutorials[0];
  const routed = withKeyboardSolutions({
    ...lesson,
    steps: [{ ...lesson.steps[0], solution: [{ modClick: "node-api", modifiers: ["Control"] }], keyboardSolution }],
  });
  expect(routed.steps[0].keyboardSolution).toBe(keyboardSolution);
});
