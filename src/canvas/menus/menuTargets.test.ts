import { describe, expect, it } from "vitest";
import { GROUP_PREFIX } from "../types";
import { menuTargets, targetRemoved } from "./menuTargets";

const EMPTY = { nodeIds: [], edgeIds: [], groupIds: [] };

describe("context menu targets", () => {
  it("names a node, a connection, an annotation or a boundary by its flow id", () => {
    expect(menuTargets({ target: "node", nodeId: "a", selection: EMPTY })).toEqual(["a"]);
    expect(menuTargets({ target: "annotation", nodeId: "t", selection: EMPTY })).toEqual(["t"]);
    expect(menuTargets({ target: "edge", edgeId: "e", selection: EMPTY })).toEqual(["e"]);
    expect(menuTargets({ target: "group", groupId: "zone", selection: EMPTY })).toEqual([GROUP_PREFIX + "zone"]);
    expect(menuTargets({ target: "canvas", selection: EMPTY })).toEqual([]);
  });

  it("names every item of a selection, boundaries included", () => {
    const selection = { nodeIds: ["a"], edgeIds: ["e"], groupIds: ["zone"] };
    expect(menuTargets({ target: "selection", selection })).toEqual(["a", "e", GROUP_PREFIX + "zone"]);
  });

  it("sees a removal among thousands of ids in one pass", () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: 8000 }, (_, i) => ({ id: `e${i}` }));
    const targets = [...nodes.map((n) => n.id), ...edges.map((e) => e.id)];
    expect(targetRemoved(targets, { nodes, edges })).toBe(false);
    expect(targetRemoved(targets, { nodes: nodes.slice(1), edges })).toBe(true);
    expect(targetRemoved(undefined, { nodes, edges })).toBe(false);
  });
});
