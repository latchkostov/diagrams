import { expect, it, vi } from "vitest";
import { actionRegistry, type ActionContext } from "../editor/actions";
import type { EditorApi } from "../editor/types";
import type { DiagramEdge } from "../model/types";
import "./routeActions";

it("offers one palette-only reset for a shaped selection and clears only waypoints", () => {
  const edges: DiagramEdge[] = [
    { id: "shaped", from: "a", to: "b", sourceSide: "bottom", waypoints: [{ x: 100, y: 200 }] },
    { id: "auto", from: "b", to: "c" },
  ];
  const updateEdges = vi.fn();
  const editor = { getEdge: (id: string) => edges.find((edge) => edge.id === id), updateEdges } as unknown as EditorApi;
  const ctx: ActionContext = {
    target: "selection",
    surface: "palette",
    editor,
    selection: { nodeIds: [], groupIds: [], edgeIds: ["shaped", "auto"] },
  };
  const items = actionRegistry.build(ctx);
  const reset = items.find((item) => item.type === "item" && item.id === "selection.reset-routes");
  expect(reset?.type).toBe("item");
  if (reset?.type !== "item") throw new Error("Missing selection reset");
  reset.run?.();
  expect(updateEdges).toHaveBeenCalledExactlyOnceWith(["shaped", "auto"], { waypoints: undefined });
  expect(edges[0].sourceSide).toBe("bottom");
  expect(actionRegistry.build({ ...ctx, surface: "menu" })).toEqual([]);
  expect(actionRegistry.build({ ...ctx, selection: { ...ctx.selection, edgeIds: ["auto"] } })).toEqual([]);
});
