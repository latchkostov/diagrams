import { expect, it } from "vitest";
import type { InternalNode } from "@xyflow/react";
import type { FlowNode } from "./types";
import { draggedGroupIds, guideCandidates } from "./useSmartGuides";
import { toFlow } from "./convert";
import { guideIndex, snapMove } from "./guides";
import { opGrowth } from "../test/opCounter";

const view = { x: -1000, y: -1000, width: 10000, height: 10000 };
const internal = (n: FlowNode): InternalNode<FlowNode> => ({
  ...n,
  measured: { width: n.width ?? 220, height: n.height ?? 72 },
  internals: { positionAbsolute: n.position, z: 0, userNode: n },
});
it("backdrops snap to stationary backdrops, exclude moving nested subtrees, and retain Alt originals", () => {
  const nodes = toFlow({
    format: "diagrams/v1",
    title: "Guides",
    edges: [],
    groups: [
      { id: "root", label: "Root", x: 0, y: 0, width: 400, height: 300 },
      { id: "inner", group: "root", label: "Inner", x: 40, y: 60, width: 300, height: 200 },
      { id: "target", label: "Target", x: 800, y: 0, width: 400, height: 300 },
    ],
    nodes: [{ id: "member", group: "inner", stencil: "service.node", label: "Member", x: 80, y: 120 }],
    annotations: [{ id: "zone", kind: "zone", text: "Zone", x: 1400, y: 0, width: 400, height: 300 }],
  }).nodes;
  const groups = draggedGroupIds([nodes.find((n) => n.id === "group:root")!], nodes);
  expect([...groups].sort()).toEqual(["inner", "root"]);
  const moving = new Map([["group:root", true]]);
  const followers = new Map(nodes.filter((n) => n.data.group && groups.has(n.data.group)).map((n) => [n.id, true]));
  expect(guideCandidates(nodes.map(internal), view, moving, followers, false)).toEqual([]);
  const boxes = guideCandidates(nodes.map(internal), view, moving, followers);
  expect(boxes.map((b) => b.x).sort((a, b) => a - b)).toEqual([800, 1400]);
  expect(
    snapMove(
      guideIndex(boxes),
      { x: 804, y: 500, width: 400, height: 300 },
      { threshold: 6, reach: 600, guides: true, grid: 10 },
    ).dx,
  ).toBe(-4);
  const copies = new Map([["copy-root", true]]);
  expect(guideCandidates(nodes.map(internal), view, copies, new Map()).length).toBe(nodes.length);
  const hidden = { ...internal(nodes[0]), hidden: true };
  const offscreen = {
    ...internal(nodes[0]),
    internals: { ...internal(nodes[0]).internals, positionAbsolute: { x: 20000, y: 0 } },
  };
  expect(guideCandidates([hidden, offscreen], view, new Map(), new Map())).toEqual([]);
});
it("candidate collection and snapping grow linearly with overlapping backdrops", () => {
  const run = (count: number) => {
    const nodes = toFlow({
      format: "diagrams/v1",
      title: "Cost",
      nodes: [],
      edges: [],
      groups: Array.from({ length: count }, (_, i) => ({
        id: `g${i}`,
        label: "Region",
        x: i % 3,
        y: i % 7,
        width: 400,
        height: 300,
      })),
    }).nodes.map(internal);
    return () => {
      const boxes = guideCandidates(nodes, view, new Map(), new Map());
      snapMove(
        guideIndex(boxes),
        { x: 403, y: 0, width: 400, height: 300 },
        { threshold: 6, reach: 600, guides: true, grid: 10 },
      );
    };
  };
  expect(opGrowth(run(64), run(512))).toBeLessThan(24);
});
