import { expect, it, vi } from "vitest";
import { ActionRegistry, builtinSections, type ActionContext, type MenuItem, type MenuNode } from "./actions";
import { selectionActions } from "./selectionActions";
import { builtinActions } from "./builtinActions";
import { surfaceCatalogs } from "../i18n/surfaces";
import { editorHarness } from "../test/editorHarness";
import type { DiagramFile } from "../model/types";

const row = (items: MenuNode[], id: string): MenuItem => {
  const item = items.find((item): item is MenuItem => item.type === "item" && item.id === id);
  if (!item) throw new Error(`Missing row: ${id}`);
  return item;
};

it("indexes endpoint labels with linear reads and labels only selected removal targets", async () => {
  await surfaceCatalogs(["selection"]);
  let reads = 0;
  const nodes = Array.from({ length: 80 }, (_, i) => ({
    get id() {
      reads++;
      return `n${i}`;
    },
    label: `Node ${i}`,
    stencil: "service.node",
    x: i * 300,
    y: 0,
  }));
  const labels = Array.from({ length: 160 }, () => vi.fn(() => ""));
  const diagram: DiagramFile = {
    format: "diagrams/v1",
    title: "Menu projection",
    nodes,
    edges: labels.map((label, i) => ({
      id: `e${i}`,
      from: "n78",
      to: "n79",
      get label() {
        return label();
      },
    })),
  };
  const editor = editorHarness(diagram).api;
  vi.spyOn(editor, "getDiagram").mockReturnValue(diagram);
  const registry = new ActionRegistry(builtinSections);
  registry.register(selectionActions());
  // Ctrl+K on the canvas: the empty canvas right-click leaves the Select tools to the palette and Inspector.
  const context: ActionContext = {
    target: "canvas",
    surface: "palette",
    editor,
    selection: { nodeIds: [], edgeIds: [], groupIds: [] },
  };
  reads = 0;
  for (const label of labels) label.mockClear();
  row(registry.build(context), "selection.select");
  expect(labels.every((label) => label.mock.calls.length === 0)).toBe(true);
  expect(reads).toBeLessThanOrEqual(nodes.length * 12);
  reads = 0;
  context.selection.edgeIds = diagram.edges.map((edge) => edge.id);
  const menu = row(registry.build(context), "selection.select");
  const removal = row(menu.children!, "selection.remove");
  expect(removal.children).toHaveLength(labels.length);
  expect(row(removal.children!, "remove-selection:edge:e159").label).toBe("Node 78 → Node 79");
  expect(labels.every((label) => label.mock.calls.length === 1)).toBe(true);
  expect(reads).toBeLessThanOrEqual(nodes.length * 12);
});

it("Select similar shares the registered node/edge eligibility and execution, excluding annotations", async () => {
  await surfaceCatalogs(["selection"]);
  const editor = editorHarness({
    format: "diagrams/v1",
    title: "Similar",
    nodes: [
      { id: "a", label: "A", stencil: "service.node", x: 0, y: 0 },
      { id: "b", label: "B", stencil: "service.node", x: 300, y: 0 },
    ],
    edges: [{ id: "ab", from: "a", to: "b" }],
    annotations: [{ id: "note", kind: "note", text: "Context", x: 0, y: 100, width: 160, height: 120 }],
  }).api;
  const run = vi.spyOn(editor, "selectSimilar").mockReturnValue(0);
  const registry = new ActionRegistry(builtinSections);
  registry.register(builtinActions());
  for (const [target, nodeId, edgeId, eligible] of [
    ["node", "a", undefined, true],
    ["edge", undefined, "ab", true],
    ["annotation", "note", undefined, false],
    ["node", "gone", undefined, false],
  ] as const) {
    const context: ActionContext = { target, nodeId, edgeId, editor, selection: editor.getSelection() };
    const menu = row(registry.build(context), "selection.select").children!;
    const similar = menu.find((item) => item.type === "item" && item.id === "item.select-similar");
    expect(!!similar).toBe(eligible);
    const palette = registry.build({ ...context, surface: "palette" });
    expect(palette.some((item) => item.type === "item" && item.id === "item.select-similar")).toBe(eligible);
    if (similar?.type === "item") {
      similar.run!();
      expect(run).toHaveBeenLastCalledWith({ nodeId, edgeId });
    }
  }
});

it("the empty canvas right-click keeps its row budget: Select is in Ctrl+K and the Inspector instead", () => {
  const editor = editorHarness({ format: "diagrams/v1", title: "Menus", nodes: [], edges: [] }).api;
  const registry = new ActionRegistry(builtinSections);
  registry.register(selectionActions());
  const selection = { nodeIds: [], edgeIds: [], groupIds: [] };
  const ids = (ctx: ActionContext) => registry.build(ctx).flatMap((n) => (n.type === "item" ? [n.id] : []));
  expect(ids({ target: "canvas", surface: "menu", editor, selection })).not.toContain("selection.select");
  expect(ids({ target: "canvas", editor, selection })).not.toContain("selection.select");
  expect(ids({ target: "canvas", surface: "palette", editor, selection })).toContain("selection.select");
  expect(ids({ target: "selection", surface: "inspector", editor, selection })).toContain("selection.select");
});
