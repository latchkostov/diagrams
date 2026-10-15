import { expect, it } from "vitest";
import { makePayload } from "../editor/clipboard";
import { toFlow } from "./convert";
import { draggedGroupIds } from "./useSmartGuides";
import type { DiagramFile } from "../model/types";

it.each([
  [32, "copy"],
  [256, "copy"],
  [32, "drag"],
  [256, "drag"],
] as const)("reads parents a bounded number of times in child-first chains (%i, %s)", (size, consumer) => {
  const diagram: DiagramFile = {
    format: "diagrams/v1",
    title: "Chain",
    nodes: [],
    edges: [],
    groups: Array.from({ length: size }, (_, i) => ({
      id: `g${i}`,
      label: "Boundary",
      group: i + 1 < size ? `g${i + 1}` : undefined,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })),
  };
  let reads = 0;
  for (const g of diagram.groups!) {
    const parent = g.group;
    Object.defineProperty(g, "group", {
      enumerable: true,
      get: () => {
        reads++;
        return parent;
      },
    });
  }
  if (consumer === "copy") {
    expect(makePayload(diagram, [], [`g${size - 1}`])?.groups).toHaveLength(size);
    expect(reads).toBeLessThan(size * 8);
    return;
  }
  const nodes = toFlow(diagram).nodes;
  reads = 0;
  for (const n of nodes) {
    const parent = n.data.group;
    Object.defineProperty(n.data, "group", {
      enumerable: true,
      get: () => {
        reads++;
        return parent;
      },
    });
  }
  expect(draggedGroupIds([nodes[nodes.length - 1]], nodes).size).toBe(size);
  expect(reads).toBeLessThan(size * 8);
});
