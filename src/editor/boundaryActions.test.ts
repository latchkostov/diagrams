import { expect, it, vi } from "vitest";
import { boundaryActions } from "./boundaryActions";
import { ActionRegistry, type ActionContext, type MenuItem } from "./actions";
import { countingReads, LINEAR_LIMIT } from "../test/complexity";
import { parseNative } from "../interop/native";
import type { EditorApi } from "./types";

function choices(count: number) {
  const parsed = parseNative(
    JSON.stringify({
      format: "diagrams/v1",
      title: "Deep boundaries",
      edges: [],
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        label: "Node",
        stencil: "service.node",
        x: 0,
        y: 0,
        group: `g${i}`,
      })),
      groups: Array.from({ length: count }, (_, i) => ({
        id: `g${i}`,
        label: "B".repeat(200),
        group: i ? `g${i - 1}` : undefined,
        x: 0,
        y: 0,
        width: 500,
        height: 500,
      })),
    }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  const d = parsed.diagram;
  const groups = countingReads(d.groups!);
  const nodes = countingReads(d.nodes);
  d.groups = groups.items;
  d.nodes = nodes.items;
  const getDiagram = vi.fn(() => d);
  const ids = nodes.items.map((n) => n.id);
  // includes() would multiply work by the size of the selection.
  ids.includes = () => {
    throw new Error("Use a selected-id Set");
  };
  const ctx: ActionContext = {
    surface: "palette",
    target: "selection",
    selection: { nodeIds: ids, edgeIds: [], groupIds: [] },
    editor: { getDiagram } as unknown as EditorApi,
  };
  const registry = new ActionRegistry();
  registry.register(boundaryActions());
  const rows = registry.build(ctx).filter((r): r is MenuItem => r.type === "item");
  const destinations = rows[0].children as MenuItem[];
  expect(destinations).toHaveLength(count);
  expect(destinations.every((r) => !r.disabled && r.hint?.endsWith("1 node"))).toBe(true);
  expect(getDiagram).toHaveBeenCalledOnce();
  expect(Math.max(...destinations.map((r) => r.hint!.length))).toBeLessThanOrEqual(520);
  expect(Math.max(...destinations.map((r) => r.keywords!.length))).toBeLessThanOrEqual(540);
  // Reusing the caller context for another opening must read a fresh document.
  registry.build(ctx);
  expect(getDiagram).toHaveBeenCalledTimes(2);
  return groups.reads() + nodes.reads();
}

it("bounds work and breadcrumb output for an accepted deep hierarchy", () => {
  expect(choices(1000) / choices(125)).toBeLessThan(LINEAR_LIMIT);
});
