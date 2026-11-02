import { expect, it, vi } from "vitest";
import { planBoundaryTransfer } from "./boundaryTransfer";
import { overlaps } from "../canvas/placement";
import { selectionOf, snapshotDiagram } from "./historySelection";
import { HistoryController } from "./historyController";
import { groupOf } from "../canvas/membership";
import { editorHarness } from "../test/editorHarness";
import { notify } from "../interop/ui/toast";
vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));
const groups = [{ id: "region", x: 0, y: 0, width: 700, height: 400 }];
const nodes = [
  { id: "a", x: 1000, y: 100, width: 100, height: 60 },
  { id: "b", x: 1200, y: 200, width: 100, height: 60 },
];
it("translates the entire set rigidly, preserving existing members", () => {
  const existing = { id: "existing", group: "region", x: 40, y: 70, width: 100, height: 60 };
  const p = planBoundaryTransfer([...nodes, existing], groups, ["a", "b", "existing"], "region")!;
  expect(p.positions.size).toBe(2);
  expect(p.positions.has("existing")).toBe(false);
  expect(p.positions.get("b")!.x - p.positions.get("a")!.x).toBe(200);
  expect(p.positions.get("b")!.y - p.positions.get("a")!.y).toBe(100);
  const grown = groups.map((g) => ({ ...g, ...p.growth.get(g.id) }));
  for (const n of nodes) expect(groupOf(grown, { ...n, ...p.positions.get(n.id)! })).toBe("region");
});
it("keeps an already enclosed set still and rejects missing or blocked destinations atomically", () => {
  const inside = nodes.map((n) => ({ ...n, x: n.x - 990, y: n.y - 70 }));
  expect([...planBoundaryTransfer(inside, groups, ["a", "b"], "region")!.positions.values()]).toEqual(
    inside.map((n) => ({ x: n.x, y: n.y })),
  );
  expect(planBoundaryTransfer(nodes, groups, ["a"], "gone")).toBeNull();
  const before = structuredClone(nodes);
  expect(
    planBoundaryTransfer(nodes, groups, ["a", "b"], "region", [{ x: -10000, y: -10000, width: 20000, height: 20000 }]),
  ).toBeNull();
  expect(nodes).toEqual(before);
});
it("removes one source subset rigidly outside every boundary, including a parent", () => {
  const nested = [...groups, { id: "inner", x: 40, y: 60, width: 400, height: 240 }];
  const inside = nodes.map((n) => ({ ...n, x: n.x - 900, group: "inner" }));
  const p = planBoundaryTransfer(inside, nested, ["a", "b"], undefined)!;
  expect(p.positions.get("b")!.x - p.positions.get("a")!.x).toBe(200);
  expect(p.positions.get("b")!.y - p.positions.get("a")!.y).toBe(100);
  for (const n of inside) expect(groupOf(nested, { ...n, ...p.positions.get(n.id)! })).toBeUndefined();
});
it("commits membership and positions once, retains the mixed selection, and announces with Undo", async () => {
  const h = editorHarness({
    format: "diagrams/v1",
    title: "Transfer",
    nodes: nodes.map((n) => ({ ...n, label: n.id, stencil: "service.node" })),
    groups: groups.map((g) => ({ ...g, label: "Region" })),
    edges: [],
  });
  const announce = vi.fn();
  h.deps.announceSelection = announce;
  h.commit();
  h.api.select({ nodeIds: ["a", "b"], groupIds: ["region"] });
  expect(await h.api.transferBoundary(["a", "b"], "region")).toBe(true);
  expect(
    h
      .nodes()
      .filter((n) => n.type === "diagram")
      .every((n) => n.data.group === "region"),
  ).toBe(true);
  expect(h.api.getSelection()).toEqual({ nodeIds: ["a", "b"], edgeIds: [], groupIds: ["region"] });
  expect(h.deps.history.hint).toHaveBeenCalledOnce();
  expect(announce).toHaveBeenCalledWith("Added 2 nodes to Region. 3 selected.");
  const action = vi.mocked(notify).mock.calls.at(-1)![1]!.action!;
  expect(action.undoes).toBe(true);
  action.run();
  expect(h.deps.history.undo).toHaveBeenCalledOnce();
});

it("revalidates a destination removed while the planner loads, without opening history", async () => {
  const h = editorHarness({
    format: "diagrams/v1",
    title: "Transfer",
    nodes: nodes.map((n) => ({ ...n, label: n.id, stencil: "service.node" })),
    groups: groups.map((g) => ({ ...g, label: "Region" })),
    edges: [],
  });
  const pending = h.api.transferBoundary(["a", "b"], "region");
  h.setNodes((ns) => ns.filter((n) => n.type !== "boundary"));
  h.commit();
  expect(await pending).toBe(false);
  expect(h.deps.history.hint).not.toHaveBeenCalled();
  expect(h.nodes().map((n) => n.position)).toEqual(nodes.map((n) => ({ x: n.x, y: n.y })));
  expect(notify).toHaveBeenLastCalledWith("Couldn't find room. Nothing moved.");
});

const small = [{ id: "region", label: "Region", x: 0, y: 0, width: 180, height: 140 }];
const wide = [nodes[0], { ...nodes[1], x: 1500 }];
function harness(ns = nodes, gs = groups) {
  return editorHarness({
    format: "diagrams/v1",
    title: "Transfer",
    edges: [],
    nodes: ns.map((n) => ({ ...n, label: n.id, stencil: "service.node" })),
    groups: gs.map((g) => ({ ...g, label: g.id })),
  });
}

it("grows the destination to contain the full rigid set", async () => {
  const plan = planBoundaryTransfer(wide, small, ["a", "b"], "region")!;
  expect(plan.growth.size).toBeGreaterThan(0);
  const grown = plan.growth.get("region")!;
  for (const n of wide) {
    const at = plan.positions.get(n.id)!;
    expect(at.x).toBeGreaterThanOrEqual(grown.x);
    expect(at.y).toBeGreaterThanOrEqual(grown.y + 24);
    expect(at.x + n.width).toBeLessThanOrEqual(grown.x + grown.width);
    expect(at.y + n.height).toBeLessThanOrEqual(grown.y + grown.height);
  }
  const h = harness(wide, small);
  const snapshot = () => ({ meta: h.deps.meta, nodes: h.nodes(), edges: h.edges() });
  const before = snapshot();
  const history = new HistoryController(before, 0);
  expect(await h.api.transferBoundary(["a", "b"], "region")).toBe(true);
  const committed = h.api.getGroup("region")!;
  expect(committed.width).toBeGreaterThan(small[0].width);
  for (const n of h.nodes().filter((n) => n.type === "diagram")) {
    expect(n.position.x).toBeGreaterThanOrEqual(committed.x);
    expect(n.position.y).toBeGreaterThanOrEqual(committed.y + 24);
    expect(n.position.x + h.deps.nodeSize.width).toBeLessThanOrEqual(committed.x + committed.width);
    expect(n.position.y + h.deps.nodeSize.height).toBeLessThanOrEqual(committed.y + committed.height);
  }
  history.commit(snapshot(), undefined, 1);
  const restored = history.step("undo", selectionOf(snapshot()))!;
  expect(snapshotDiagram(restored)).toEqual(snapshotDiagram(before));
  expect(history.history.index).toBe(0);
  expect(h.deps.history.hint).toHaveBeenCalledOnce();
});

it.each(["node", "boundary"])("rejects growth onto an unrelated node or boundary (%s)", (kind) => {
  const target = { id: "region", x: 0, y: 0, width: 100, height: 100 };
  const mover = { id: "a", x: 1000, y: 1000, width: 500, height: 500 };
  const blocker = { id: "blocker", x: 120, y: 0, width: 10, height: 100 };
  expect(planBoundaryTransfer([mover], [target], ["a"], "region")!.growth.size).toBe(1);
  expect(
    planBoundaryTransfer(
      kind === "node" ? [mover, blocker] : [mover],
      kind === "boundary" ? [target, blocker] : [target],
      ["a"],
      "region",
    ),
  ).toBeNull();
});

it.each([false, true])("removes from a 3000 by 3000 boundary and nested ancestors (%s)", (nested) => {
  const big = [{ id: "outer", x: 0, y: 0, width: 3000, height: 3000 }];
  const gs = nested ? [...big, { id: "inner", x: 1000, y: 1000, width: 1000, height: 1000 }] : big;
  const ns = [{ id: "a", x: 1450, y: 1450, width: 100, height: 60, group: nested ? "inner" : "outer" }];
  const plan = planBoundaryTransfer(ns, gs, ["a"], undefined)!;
  expect(plan).not.toBeNull();
  for (const g of gs) expect(overlaps({ ...ns[0], ...plan.positions.get("a")! }, g)).toBe(false);
  expect(plan.growth.size).toBe(0);
});

const sourceGroups = [
  { id: "left", x: 0, y: 0, width: 400, height: 400 },
  { id: "right", x: 500, y: 0, width: 400, height: 400 },
];
const sourceNodes = [
  { id: "a", x: 280, y: 130, width: 60, height: 50, group: "left" },
  { id: "b", x: 280, y: 230, width: 60, height: 50, group: "left" },
  { id: "c", x: 560, y: 130, width: 60, height: 50, group: "right" },
  { id: "d", x: 560, y: 230, width: 60, height: 50, group: "right" },
];
it("removes multiple source subsets without collisions", () => {
  const plan = planBoundaryTransfer(
    sourceNodes,
    sourceGroups,
    sourceNodes.map((n) => n.id),
    undefined,
  )!;
  const at = sourceNodes.map((n) => ({ ...n, ...plan.positions.get(n.id)! }));
  expect(at[1].x - at[0].x).toBe(0);
  expect(at[1].y - at[0].y).toBe(100);
  expect(at[3].x - at[2].x).toBe(0);
  expect(at[3].y - at[2].y).toBe(100);
  for (let i = 0; i < at.length; i++) {
    expect(groupOf(sourceGroups, at[i])).toBeUndefined();
    for (let j = i + 1; j < at.length; j++) expect(overlaps(at[i], at[j])).toBe(false);
  }
  // Both subsets prefer the same gap; the second must account for the first placement.
  const firstOnly = planBoundaryTransfer(sourceNodes, sourceGroups, ["a", "b"], undefined)!;
  const secondOnly = planBoundaryTransfer(sourceNodes, sourceGroups, ["c", "d"], undefined)!;
  expect(plan.positions.get("a")).toEqual(firstOnly.positions.get("a"));
  expect(
    overlaps(
      { ...sourceNodes[0], ...firstOnly.positions.get("a")! },
      { ...sourceNodes[2], ...secondOnly.positions.get("c")! },
    ),
  ).toBe(true);
});

it("rejects all removals when a later subset cannot be placed", async () => {
  const gs = [sourceGroups[0], { id: "right", x: 10000, y: 0, width: 400, height: 400 }];
  const ns = sourceNodes.map((n) => (n.group === "right" ? { ...n, x: n.x + 9500 } : n));
  const obstacle = { x: 7000, y: -3000, width: 6000, height: 6000 };
  expect(planBoundaryTransfer(ns, gs, ["a", "b"], undefined, [obstacle])).not.toBeNull();
  expect(
    planBoundaryTransfer(
      ns,
      gs,
      ns.map((n) => n.id),
      undefined,
      [obstacle],
    ),
  ).toBeNull();
  const h = harness(ns, gs);
  h.deps.edgeMarks = () => [obstacle];
  h.api.select({ nodeIds: ns.map((n) => n.id), groupIds: ["left"] });
  const before = h.api.getDiagram();
  const selected = h.api.getSelection();
  expect(await h.api.transferBoundary(ns.map((n) => n.id))).toBe(false);
  expect(h.api.getDiagram()).toEqual(before);
  expect(h.api.getSelection()).toEqual(selected);
  expect(h.deps.history.hint).not.toHaveBeenCalled();
});

it.each(["zone", "text"] as const)("adds inside a %s backdrop without moving or growing it", async (kind) => {
  const h = editorHarness({
    format: "diagrams/v1",
    title: "Backdrop",
    edges: [],
    nodes: [{ id: "a", label: "A", stencil: "service.node", x: 2000, y: 100 }],
    groups: groups.map((g) => ({ ...g, label: "Region" })),
    annotations: [{ id: "backdrop", kind, text: "Context", x: -5000, y: -5000, width: 10000, height: 10000 }],
  });
  const before = h.api.getDiagram();
  expect(await h.api.transferBoundary(["a"], "region")).toBe(true);
  expect(h.api.getNode("a")?.group).toBe("region");
  expect(h.api.getDiagram().groups).toEqual(before.groups);
  expect(h.api.getDiagram().annotations).toEqual(before.annotations);
});

it.each(["b", "gone", undefined])(
  "reveals the invocation's surviving focused node, with a selected-node fallback (%s)",
  async (focused) => {
    const h = harness();
    h.api.select({ nodeIds: ["a", "b"], groupIds: ["region"] });
    h.deps.focusedNode = () => focused;
    const pending = h.api.transferBoundary(["a", "b"], "region");
    h.deps.focusedNode = () => "a";
    expect(await pending).toBe(true);
    expect(h.deps.reveal).toHaveBeenCalledWith(focused === "b" ? "b" : "a");
  },
);
