import { describe, expect, it } from "vitest";
import { ActionRegistry, builtinSections, type ActionContext, type MenuNode } from "./actions";
import type { EditorApi } from "./types";

const ctx = (target: ActionContext["target"]): ActionContext => ({
  target,
  selection: { nodeIds: [], edgeIds: [], groupIds: [] },
  editor: {} as EditorApi,
});
const ids = (items: MenuNode[]) =>
  items.map((i) => (i.type === "item" ? i.id : i.type === "header" ? `[${i.label}]` : "---"));

describe("action registry", () => {
  it("builds per target, ordered by section with separators", () => {
    const r = new ActionRegistry(builtinSections);
    r.register([
      { id: "del", section: "danger", targets: ["node"], label: "Delete" },
      { id: "rename", section: "edit", targets: ["node"], label: "Rename" },
      { id: "copy", section: "clipboard", targets: ["node", "edge"], label: "Copy" },
      { id: "paste", section: "clipboard", targets: ["canvas"], label: "Paste" },
    ]);
    expect(ids(r.build(ctx("node")))).toEqual(["rename", "---", "copy", "---", "del"]);
    expect(ids(r.build(ctx("canvas")))).toEqual(["paste"]);
  });

  it("the simulation section stays hidden until a provider registers a visible action", () => {
    const r = new ActionRegistry(builtinSections);
    r.register([{ id: "rename", section: "edit", targets: ["node"], label: "Rename" }]);
    expect(ids(r.build(ctx("node")))).toEqual(["rename"]);
    let running = false;
    const off = r.register([
      { id: "sim.inject", section: "simulation", targets: ["node"], label: "Inject 10 messages", when: () => running },
    ]);
    expect(ids(r.build(ctx("node")))).toEqual(["rename"]);
    running = true;
    expect(ids(r.build(ctx("node")))).toEqual(["rename", "---", "[Simulation]", "sim.inject"]);
    off();
    expect(ids(r.build(ctx("node")))).toEqual(["rename"]);
  });

  it("resolves dynamic labels, disabled and checked states, and runs with the context", () => {
    const r = new ActionRegistry(builtinSections);
    const seen: string[] = [];
    r.register([
      {
        id: "x",
        section: "edit",
        targets: ["edge"],
        label: (c) => `On ${c.target}`,
        enabled: () => false,
        checked: () => true,
        run: (c) => seen.push(c.target),
      },
    ]);
    const [item] = r.build(ctx("edge"));
    expect(item).toMatchObject({ type: "item", label: "On edge", disabled: true, checked: true });
    if (item.type === "item") item.run?.();
    expect(seen).toEqual(["edge"]);
  });

  it("hides submenus with no items and orders by `order`", () => {
    const r = new ActionRegistry(builtinSections);
    r.register([
      { id: "empty", section: "edit", targets: ["node"], label: "Empty", children: () => [] },
      { id: "b", section: "edit", targets: ["node"], label: "B", order: 20 },
      { id: "a", section: "edit", targets: ["node"], label: "A", order: 10 },
    ]);
    expect(ids(r.build(ctx("node")))).toEqual(["a", "b"]);
  });

  it("re-registering an id replaces it; the old disposer doesn't remove the new one", () => {
    const r = new ActionRegistry(builtinSections);
    const off1 = r.register([{ id: "a", section: "edit", targets: ["node"], label: "Old" }]);
    r.register([{ id: "a", section: "edit", targets: ["node"], label: "New" }]);
    off1();
    expect(r.build(ctx("node"))).toMatchObject([{ label: "New" }]);
  });

  it("a throwing `when` hides the action instead of breaking the menu", () => {
    const r = new ActionRegistry(builtinSections);
    const err = console.error;
    console.error = () => {};
    r.register([
      {
        id: "bad",
        section: "edit",
        targets: ["node"],
        label: "Bad",
        when: () => {
          throw new Error("x");
        },
      },
      { id: "ok", section: "edit", targets: ["node"], label: "Ok" },
    ]);
    expect(ids(r.build(ctx("node")))).toEqual(["ok"]);
    console.error = err;
  });
});
