import { expect, it, vi } from "vitest";
import type { InternalNode } from "@xyflow/react";
import type { FlowNode } from "../canvas/types";
import { labNodesReady } from "./readiness";

it("stops reading nodes after reporting Lab readiness", () => {
  const nodes = new Map(
    Array.from({ length: 1000 }, (_, i) => [
      String(i),
      {
        type: "diagram",
        measured: { width: 220, height: 72 },
        internals: { handleBounds: {} },
      } as InternalNode<FlowNode>,
    ]),
  );
  const values = vi.spyOn(nodes, "values");
  expect(labNodesReady(nodes, 1000, false)).toBe(true);
  expect(values).toHaveBeenCalledOnce();
  values.mockClear();
  for (let viewport = 0; viewport < 60; viewport++) expect(labNodesReady(nodes, 1000, true)).toBe(true);
  expect(values).not.toHaveBeenCalled();
});

it("waits for descendants while ignoring hidden and zero-area boundaries", () => {
  const nodes = new Map<string, InternalNode<FlowNode>>([
    ["empty", { type: "boundary", width: 0, measured: {}, internals: {} } as InternalNode<FlowNode>],
    ["child", { type: "diagram", measured: {}, internals: {} } as InternalNode<FlowNode>],
  ]);
  expect(labNodesReady(nodes, 2, false)).toBe(false);
  nodes.get("child")!.hidden = true;
  expect(labNodesReady(nodes, 2, false)).toBe(true);
  expect(labNodesReady(nodes, 3, false)).toBe(false);
  expect(labNodesReady(new Map(), 0, false)).toBe(true);
});
