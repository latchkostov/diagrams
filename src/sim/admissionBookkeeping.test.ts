import { afterEach, expect, it, vi } from "vitest";
import * as resources from "./engine/resources";
import { createEngine } from "./engine";
import type { Node } from "./engine/model";
import type { DiagramFile } from "../model/types";

afterEach(() => vi.restoreAllMocks());

it.each(["p1", "p3-w1"] as const)("empty %s admissions do not dirty or enter a pass", (revision) => {
  let nodes!: Map<string, Node>;
  const create = resources.createResources;
  vi.spyOn(resources, "createResources").mockImplementation((...args) => {
    nodes = args[0];
    return create(...args);
  });
  const d: DiagramFile = {
    format: "diagrams/v2",
    title: "Admission bookkeeping",
    planning: { revision },
    nodes: [
      {
        id: "worker",
        stencil: "generic.service",
        label: "Worker",
        x: 0,
        y: 0,
        props: { concurrency: 1, latencyMs: 100, jitter: 0 },
      },
    ],
    edges: [],
  };
  const e = createEngine({ seed: 7, scale: 5 });
  e.load(d);
  const node = nodes.get("worker")!;
  let dirty = node.admissionDirty;
  const writes = vi.fn((value: boolean) => {
    dirty = value;
  });
  Object.defineProperty(node, "admissionDirty", { configurable: true, get: () => dirty, set: writes });
  for (const status of ["up", "paused", "down"] as const) {
    e.setNodeStatus("worker", status);
    writes.mockClear();
    e.step(100);
    expect(writes).not.toHaveBeenCalled();
  }
  e.setNodeStatus("worker", "up");
  e.inject("worker", 4);
  e.step(10);
  expect(writes).toHaveBeenCalled();
  const cp = e.checkpoint();
  e.step(5000);
  const expected = e.snapshot();
  expect(expected.nodes.worker.processed).toBe(4);
  e.restore(cp);
  e.step(5000);
  expect(e.snapshot()).toEqual(expected);
});
