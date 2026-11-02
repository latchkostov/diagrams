import { expect, it } from "vitest";
import { extendPick, removePick, pickArea } from "./selectionCommands";
import { matches, shortcutFor } from "./shortcuts";
import { editorHarness } from "../test/editorHarness";
import { vi } from "vitest";
import type { BoxItem } from "../canvas/gestures";

it("extends one explicit item idempotently, preserving mixed selections without incident edges", () => {
  const before = { nodes: ["a", "group:region"], edges: ["existing"] };
  const after = extendPick(before, { kind: "node", id: "b" });
  expect(after).toEqual({ nodes: ["a", "group:region", "b"], edges: ["existing"] });
  expect(extendPick(after, { kind: "node", id: "b" })).toBe(after);
  expect(extendPick(after, { kind: "edge", id: "ab" })).toEqual({ ...after, edges: ["existing", "ab"] });
  expect(before.nodes).toEqual(["a", "group:region"]);
});

it("removal goes to the next remaining selected item in reading order and wraps to the canvas", () => {
  const a = { kind: "node" as const, id: "a" },
    b = { kind: "node" as const, id: "b" },
    edge = { kind: "edge" as const, id: "ab" };
  const order = [a, edge, b];
  const before = { nodes: ["a", "b"], edges: ["ab"] };
  expect(removePick(before, a, order)?.target).toEqual(edge);
  expect(removePick(before, b, order)?.target).toEqual(a);
  expect(removePick({ nodes: ["b"], edges: [] }, b, order)).toEqual({
    pick: { nodes: [], edges: [] },
    target: undefined,
  });
  expect(removePick(before, { kind: "node", id: "gone" }, order)).toBeNull();
});

const items: BoxItem[] = [
  { id: "a", x: 10, y: 20, width: 100, height: 80 },
  { id: "b", x: 210, y: 120, width: 120, height: 100 },
  { id: "inside", x: 140, y: 50, width: 40, height: 40 },
  { id: "touching", x: 320, y: 80, width: 100, height: 50 },
  { id: "region", x: 0, y: 30, width: 40, height: 40, backdrop: true },
];
const edges = [
  { id: "ab", source: "a", target: "b" },
  { id: "outside", source: "a", target: "touching" },
  { id: "hidden", source: "a", target: "b", hidden: true },
];

it("area selection uses full anchor bounds, containment, backdrop and visible internal-edge rules", () => {
  const whole = pickArea(items, edges, "a", "b", true)!;
  expect(whole.rect).toEqual({ x: 10, y: 20, width: 320, height: 200 });
  expect(whole.pick).toEqual({ nodes: ["a", "b", "inside"], edges: ["ab"] });
  const touching = pickArea(items, edges, "b", "a", false)!;
  expect(touching.pick).toEqual({ nodes: ["a", "b", "inside", "touching"], edges: ["ab", "outside"] });
  expect(pickArea(items, edges, "gone", "a", true)).toBeNull();
});

it("adding an area unions nodes before inferring edges, and preserves explicit existing edges", () => {
  const selected = pickArea(items, edges, "a", "a", true, { nodes: ["b"], edges: ["existing"] })!;
  expect(selected.pick).toEqual({ nodes: ["b", "a"], edges: ["ab", "existing"] });
});

it("Shift navigation accelerators are disjoint from navigation, nudges and quick-add, including physical brackets", () => {
  const base = { ctrlKey: true, altKey: true, metaKey: false, shiftKey: true };
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    expect(shortcutFor({ ...base, key, code: key })).toBe("extend-toward");
    expect(shortcutFor({ ...base, key, code: key, shiftKey: false })).toBe("select-toward");
    expect(matches({ ...base, key }, "Alt+Shift+" + key)).toBe(false);
  }
  expect(shortcutFor({ ...base, key: "}", code: "BracketRight" })).toBe("extend-edge-out");
  expect(shortcutFor({ ...base, key: "{", code: "BracketLeft" })).toBe("extend-edge-in");
});

it("selection getters read queued writes before React Flow has committed either array", () => {
  const h = editorHarness({
    format: "diagrams/v1",
    title: "Queued",
    nodes: [
      { id: "a", stencil: "service.node", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "service.node", label: "B", x: 300, y: 0 },
    ],
    edges: [{ id: "ab", from: "a", to: "b" }],
  });
  h.deps.setNodes = vi.fn();
  h.deps.setEdges = vi.fn();
  h.commit();
  h.api.select({ nodeIds: ["a"], edgeIds: ["ab"] });
  expect(h.nodes().some((n) => n.selected)).toBe(false);
  expect(h.api.getSelection()).toEqual({ nodeIds: ["a"], edgeIds: ["ab"], groupIds: [] });
  const pick = extendPick(
    { nodes: h.api.getSelection().nodeIds, edges: h.api.getSelection().edgeIds },
    { kind: "node", id: "b" },
  );
  h.api.select({ nodeIds: [...pick.nodes], edgeIds: [...pick.edges] });
  expect(h.api.getSelection()).toEqual({ nodeIds: ["a", "b"], edgeIds: ["ab"], groupIds: [] });
});
