import { expect, it, vi } from "vitest";
import { validateAllocationActions } from "./allocation";
import { resourceLesson } from "../model/autoscaling";
import type { NodeSimProps } from "./types";
import { LifecycleBudgetError } from "../model/resourceBudget";
import * as budgets from "../model/resourceBudget";
import { createEngine } from "./engine";

it.each([
  null,
  true,
  "on",
  { mode: "on" },
  { mode: "on", controller: null },
  { mode: "on", controller: { maxReplicas: "many" } },
  { mode: "on", controller: { maxReplicas: NaN } },
  { mode: "on", controller: { maxReplicas: Infinity } },
])("edits and clears malformed raw autoscaling safely (%j)", (autoscaling) => {
  const engine = createEngine();
  engine.load({
    format: "diagrams/v2",
    planning: { revision: "p3-a1" },
    title: "Raw props",
    nodes: [
      {
        id: "n",
        stencil: "service.dotnet",
        label: "Service",
        x: 0,
        y: 0,
        props: { resources: resourceLesson(), autoscaling },
      },
    ],
    edges: [],
  });
  expect(() => engine.setNodeProps("n", { replicas: 2 })).not.toThrow();
  expect(() => engine.setNodeProps("n", { autoscaling: undefined })).not.toThrow();
  // Invalid maxima must not turn the total into NaN and suppress a real budget refusal.
  const nodes = Array.from({ length: 25 }, (_, i) => ({
    id: `n${i}`,
    rawProps: { resources: resourceLesson(), replicas: 1000, autoscaling },
  }));
  expect(() => validateAllocationActions(nodes, [{ node: "n0", props: { replicas: 1100 } }], 1)).toThrow(
    LifecycleBudgetError,
  );
});

it("engine preflight performs N + 2A contribution calculations", () => {
  const nodes = Array.from({ length: 5000 }, (_, i) => ({
    id: `n${i}`,
    stencil: "service.dotnet",
    label: "Service",
    x: 0,
    y: 0,
  }));
  const engine = createEngine();
  engine.load({ format: "diagrams/v2", planning: { revision: "p3-a1" }, title: "Batch", nodes, edges: [] });
  const actions = Array.from({ length: 1000 }, (_, i) => ({ node: `n${i}`, props: { replicas: 2 } }));
  const count = vi.spyOn(budgets, "resourceAllocationCount");
  const fullScans = vi.spyOn(budgets, "resourceBudgetExceeded");
  try {
    engine.validateLifecycleActions(actions);
    const work = count.mock.calls.length + fullScans.mock.calls.reduce((n, [d]) => n + d.nodes.length, 0);
    expect(work).toBeGreaterThan(0);
    expect(work).toBeLessThanOrEqual(nodes.length + 2 * actions.length);
  } finally {
    count.mockRestore();
    fullScans.mockRestore();
  }
});

it("projects only three allocation fields and reads nodes once for a batch of ordered actions", () => {
  let reads = 0;
  const nodes = Array.from({ length: 5000 }, (_, i) => ({
    id: `n${i}`,
    rawProps: new Proxy(
      { replicas: 1 },
      {
        get(target, key) {
          expect(["resources", "replicas", "autoscaling"]).toContain(key);
          reads++;
          return Reflect.get(target, key);
        },
        ownKeys() {
          throw new Error("Do not traverse unrelated properties");
        },
      },
    ),
  }));
  validateAllocationActions(
    nodes,
    Array.from({ length: 1000 }, (_, i) => ({ node: `n${i}`, props: { replicas: 2 } })),
    1,
  );
  expect(reads).toBe(3 * nodes.length);
});

it("unrelated actions do not enumerate the graph", () => {
  const iterator = vi.fn(() => {
    throw new Error("No projection needed");
  });
  validateAllocationActions({ [Symbol.iterator]: iterator }, [{ node: "n", props: { concurrency: 2 } }], 1);
  expect(iterator).not.toHaveBeenCalled();
});

it("checks intermediate timeline allocations while batch setters validate the final allocation", () => {
  const nodes = Array.from({ length: 25 }, (_, i) => ({
    id: `n${i}`,
    rawProps: { resources: resourceLesson(), replicas: 1000 },
  }));
  const actions = [
    { node: "n0", props: { replicas: 1100 } },
    { node: "n1", props: { replicas: 900 } },
  ];
  expect(() => validateAllocationActions(nodes, actions, 1)).toThrow(LifecycleBudgetError);
  expect(() => validateAllocationActions(nodes, actions, 1, { sequential: false })).not.toThrow();
});

it("resource removal and explicit undefined replacements release their allocation", () => {
  const nodes = Array.from({ length: 25 }, (_, i) => ({
    id: `n${i}`,
    rawProps: { resources: resourceLesson(), replicas: 1000 },
  }));
  const actions: { node: string; props: NodeSimProps }[] = [
    { node: "n0", props: { resources: undefined } },
    { node: "n1", props: { replicas: 2000 } },
  ];
  expect(() => validateAllocationActions(nodes, actions, 1)).not.toThrow();
});
