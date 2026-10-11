import { describe, expect, it } from "vitest";
import type { DiagramAnnotation, DiagramFile } from "../model/types";
import { ActionRegistry, builtinSections, type ActionContext, type MenuItem, type MenuNode } from "./actions";
import { annotateMenu, builtinActions } from "./builtinActions";
import { shortcutFor, type KeyLike } from "./shortcuts";
import type { EditorApi } from "./types";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

const items = (nodes: MenuNode[]) => nodes.filter((n): n is MenuItem => n.type === "item");

function setup(annotations: DiagramAnnotation[]) {
  const calls: unknown[][] = [];
  const diagram = { format: "diagrams/v1", title: "t", nodes: [], edges: [], annotations } as DiagramFile;
  const editor = {
    getDiagram: () => diagram,
    getNode: () => undefined,
    getAnnotation: (id: string) => annotations.find((a) => a.id === id),
    addAnnotation: (...args: unknown[]) => calls.push(["add", ...args]),
    updateAnnotation: (...args: unknown[]) => calls.push(["update", ...args]),
    startEditing: (...args: unknown[]) => calls.push(["edit", ...args]),
    hasClipboard: () => false,
    canUndo: () => false,
    canRedo: () => false,
    prefs: { snap: true, grid: true, minimap: true, inspector: true },
  } as unknown as EditorApi;
  const r = new ActionRegistry(builtinSections);
  r.register(builtinActions());
  const build = (c: Partial<ActionContext>) =>
    r.build({ target: "canvas", selection: { nodeIds: [], edgeIds: [], groupIds: [] }, editor, ...c });
  return { calls, build };
}

describe("annotation actions", () => {
  it("T adds text; Shift+T and Ctrl+T don't", () => {
    expect(shortcutFor(key("t"))).toBe("add-text");
    expect(shortcutFor(key("T", { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key("t", { ctrlKey: true }))).toBeNull();
  });

  it("the canvas menu offers Annotate ▸ Text / Note / Zone / Shape ▸ at the click, within the 12-item budget", () => {
    const { build, calls } = setup([]);
    const menu = items(build({ point: { x: 10, y: 20 } }));
    expect(menu.length).toBeLessThanOrEqual(12);
    const add = menu.find((i) => i.id === "canvas.annotate")!;
    expect(add.label).toBe("Annotate");
    expect(items(add.children!).map((i) => i.label)).toEqual(["Text", "Note", "Zone", "Shape"]);
    const shapes = items(items(add.children!).find((i) => i.id === "annotate:shape")!.children!);
    expect(shapes.map((i) => i.id)).toEqual([
      "annotate:shape:rect",
      "annotate:shape:rounded",
      "annotate:shape:ellipse",
      "annotate:shape:diamond",
      "annotate:shape:cylinder",
    ]);
    shapes[2].run!();
    items(add.children!)[1].run!();
    expect(calls).toEqual([
      ["add", "shape", { at: { x: 10, y: 20 }, shape: "ellipse" }],
      ["add", "note", { at: { x: 10, y: 20 }, shape: undefined }],
    ]);
  });

  it("an annotation's menu edits its text, colour and (for shapes) shape, but has no node verbs", () => {
    const { build, calls } = setup([
      { id: "s", kind: "shape", shape: "rect", text: "", x: 0, y: 0, width: 10, height: 10 },
      { id: "z", kind: "zone", text: "Edge", x: 0, y: 0, width: 10, height: 10 },
    ]);
    const shapeMenu = items(
      build({ target: "annotation", nodeId: "s", selection: { nodeIds: ["s"], edgeIds: [], groupIds: [] } }),
    );
    const ids = shapeMenu.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining(["annotation.edit", "annotation.color", "annotation.shape", "item.copy", "item.delete"]),
    );
    expect(ids).not.toContain("node.change-stencil");
    expect(ids).not.toContain("selection.group");
    items(shapeMenu.find((i) => i.id === "annotation.color")!.children!).find((i) => i.id === "annotation-color:green")!
      .run!();
    expect(calls).toEqual([["update", "s", { color: "green" }]]);

    const zoneMenu = items(
      build({ target: "annotation", nodeId: "z", selection: { nodeIds: ["z"], edgeIds: [], groupIds: [] } }),
    );
    expect(zoneMenu.find((i) => i.id === "annotation.edit")?.label).toBe("Rename");
    expect(zoneMenu.map((i) => i.id)).not.toContain("annotation.shape");
  });

  it("the Add menu leaves are what the command palette lists", () => {
    const leaves = annotateMenu(() => {});
    expect(
      items(leaves)
        .map((i) => i.keywords ?? "")
        .join(" "),
    ).toMatch(/sticky/);
  });
});
