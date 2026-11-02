import { expect, it, vi } from "vitest";
import { planBoundaryTransfer } from "./boundaryTransfer";
import { groupOf } from "../canvas/membership";
import { editorHarness } from "../test/editorHarness";
import { notify } from "../interop/ui/toast";
vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));
const groups = [{ id: "region", x: 0, y: 0, width: 700, height: 400 }];
const nodes = [
  { id: "a", x: 1000, y: 100, width: 100, height: 60 },
  { id: "b", x: 1200, y: 200, width: 100, height: 60 },
];
it("translates the entire set rigidly, preserving existing members and safe growth", () => {
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
it("removes each source subset rigidly outside every boundary, including a parent", () => {
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
