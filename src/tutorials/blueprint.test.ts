import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildBlueprint, blueprintLayout, stepInput } from "./blueprint";
import { quickAdd } from "./catalog/quickAdd";
import { mobileApi } from "./catalog/mobileApi";
import { insertOnEdge } from "./catalog/insertOnEdge";
import { ratesAndInputs } from "./catalog/ratesAndInputs";
import { dotsAndSides } from "./catalog/dotsAndSides";
import { dependencies2 } from "./catalog/dependencies2";
import { circuitBreaker } from "./catalog/circuitBreaker";
import { annotate } from "./catalog/annotate";
import { loadTutorialStart } from "./start";
import { t } from "../i18n";

it("draws add-after and rename edits, keeping each step's numbered marker", async () => {
  const initial = await loadTutorialStart(quickAdd);
  const original = structuredClone(initial);
  const board = buildBlueprint(quickAdd, initial);
  expect(board.kind).toBe("drawing");
  expect(board.nodes.map((n) => [n.subject, n.marks])).toEqual([
    ["app", [1]],
    ["api", [2, 3]],
    ["db", [4]],
  ]);
  expect(board.nodes.find((n) => n.subject === "api")?.label).toBe("Web API");
  expect(board.edges.map((e) => [e.from, e.to])).toEqual([
    ["app", "api"],
    ["api", "db"],
  ]);
  const layout = blueprintLayout(board);
  expect(new Set([...layout.positions.values()].map((p) => p.y)).size).toBe(1);
  expect(layout.positions.get("app")!.x).toBeLessThan(layout.positions.get("api")!.x);
  expect(initial).toEqual(original);
});

it("connects independently added nodes and puts the marker on the actual connection", async () => {
  const board = buildBlueprint(mobileApi, await loadTutorialStart(mobileApi));
  expect(board.edges).toEqual([{ from: "app", to: "api", marks: [3] }]);
  expect(board.nodes.find((n) => n.subject === "api")?.marks).toEqual([2, 4]);
});

it("keeps a named connection's identity and markers when reconnecting its destination", async () => {
  const board = buildBlueprint(dotsAndSides, await loadTutorialStart(dotsAndSides));
  expect(board.edges).toHaveLength(1);
  expect(board.edges[0]).toMatchObject({
    from: "app",
    to: "b",
    label: t("tutorials.dotsAndSides.edgeName"),
    marks: [1, 2, 3, 4],
  });
  expect(new Set([...blueprintLayout(board).positions.values()].map((p) => p.y)).size).toBe(1);
});

it("inserts between existing subjects and removes the original bypass", async () => {
  const board = buildBlueprint(insertOnEdge, await loadTutorialStart(insertOnEdge));
  expect(board.edges.map((e) => [e.from, e.to])).toEqual([
    ["app", "gw"],
    ["gw", "api"],
  ]);
  expect(board.nodes.find((n) => n.subject === "gw")?.marks).toEqual([1, 2]);
  const layout = blueprintLayout(board);
  expect(layout.positions.get("app")!.x).toBeLessThan(layout.positions.get("gw")!.x);
  expect(layout.positions.get("gw")!.x).toBeLessThan(layout.positions.get("api")!.x);
});

it("builds a before → after settings card from the real starting value and authored patch", async () => {
  const board = buildBlueprint(ratesAndInputs, await loadTutorialStart(ratesAndInputs));
  expect(board.kind).toBe("settings");
  expect(board.changes[0]).toEqual({ step: 1, setting: ratesAndInputs.steps[0].title(), before: 2, after: 6 });
  expect(board.changes).toContainEqual({ step: 5, setting: ratesAndInputs.steps[4].title(), before: 1, after: 3 });
  expect(board.changes.at(-1)).toMatchObject({ before: 1, after: 2 });
});

it("previews enabling the circuit breaker from its starting diagram as Off → On", async () => {
  const initial = await loadTutorialStart(circuitBreaker);
  const board = buildBlueprint(circuitBreaker, initial);
  expect(board.kind).toBe("settings");
  expect(board.changes).toEqual([{ step: 1, setting: circuitBreaker.steps[0].title(), before: false, after: true }]);
});

it("previews removing an optional configuration as On → Off", () => {
  const lesson = {
    ...quickAdd,
    subjects: { api: { stencils: ["generic.service"] } },
    steps: [{ ...quickAdd.steps[0], demo: [{ kind: "prop" as const, subject: "api", props: { breaker: undefined } }] }],
  };
  const board = buildBlueprint(lesson, {
    format: "diagrams/v1",
    title: "",
    edges: [],
    nodes: [{ id: "api", stencil: "generic.service", label: quickAdd.title(), x: 0, y: 0, props: { breaker: {} } }],
  });
  expect(board.kind).toBe("settings");
  expect(board.changes).toEqual([{ step: 1, setting: lesson.steps[0].title(), before: true, after: false }]);
});

it("uses steps only when the annotation lesson has no drawable subjects", async () => {
  expect(buildBlueprint(annotate, await loadTutorialStart(annotate)).kind).toBe("steps");
});

it("turns nested setting patches into named scalar changes, never JSON arrays or objects", () => {
  const board = buildBlueprint(dependencies2, {
    format: "diagrams/v1",
    title: dependencies2.title(),
    nodes: [
      { id: "api", stencil: "generic.service", label: dependencies2.title(), x: 0, y: 0 },
      { id: "config", stencil: "azure.app-config", label: dependencies2.title(), x: 200, y: 0 },
    ],
    edges: [
      { id: "config-edge", from: "api", to: "config", relation: "config", props: { settings: [{ key: "Existing" }] } },
    ],
  });
  expect(board.kind).toBe("settings");
  expect(board.changes.length).toBeGreaterThan(0);
  expect(board.changes.every((c) => typeof c.before !== "object" && typeof c.after !== "object")).toBe(true);
  expect(board.changes.at(-1)).toMatchObject({ after: true, detail: "Notifications:Token" });
});

it("keeps forks, disconnected nodes and cycles instead of implying adjacency or truncating", () => {
  const board = {
    kind: "drawing" as const,
    nodes: Array.from({ length: 7 }, (_, i) => ({
      subject: `${i}`,
      stencil: "generic.service",
      label: `${i}`,
      marks: [],
    })),
    edges: [
      { from: "0", to: "1", marks: [] },
      { from: "0", to: "2", marks: [] },
      { from: "3", to: "4", marks: [] },
      { from: "4", to: "3", marks: [] },
    ],
    changes: [],
  };
  const { positions } = blueprintLayout(board);
  expect(positions.size).toBe(7);
  expect(positions.get("1")!.x).toBe(positions.get("2")!.x);
  expect(positions.get("1")!.y).not.toBe(positions.get("2")!.y);
});

it("extracts the taught inputs for the shared platform-aware key parser", () => {
  expect(quickAdd.steps.map(stepInput)).toEqual(["Double-click", "[Alt]+[ArrowRight]", "Type", "[Alt]+[ArrowRight]"]);
});

it("keeps the rail width, 520px column breakpoint and phone footer in the shipped stylesheet", () => {
  const css = readFileSync(new URL("./handoff.css", import.meta.url), "utf8");
  expect(css).toMatch(/width:\s*clamp\(440px, 30vw, 600px\)/);
  expect(css).toMatch(/@container handoff \(min-width: 520px\)/);
  expect(css).toMatch(/@media \(max-width: 640px\)/);
  expect(css).toMatch(/\.handoff-footer\s*\{[^}]*flex:\s*none/);
  expect(css).toMatch(/\.handoff-board\s*\{[^}]*flex:\s*0 1 320px/);
});
