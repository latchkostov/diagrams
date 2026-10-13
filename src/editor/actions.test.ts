import { describe, expect, it, vi } from "vitest";
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

  it("offers each action only in the modes it declares (default edit), whatever its id", () => {
    const r = new ActionRegistry(builtinSections);
    r.registerSection({ id: "simulation", order: 5, title: "Live" });
    r.register([
      { id: "rename", section: "edit", targets: ["node"], label: "Rename", modes: ["edit", "live"] },
      { id: "duplicate", section: "edit", targets: ["node"], label: "Duplicate" },
      // Not a `sim.*` id: availability comes from metadata, not naming conventions.
      { id: "capacity.explain", section: "simulation", targets: ["node"], label: "Explain capacity", modes: ["live"] },
      { id: "sim.inject", section: "simulation", targets: ["node"], label: "Inject", modes: ["live"] },
    ]);
    expect(ids(r.build(ctx("node")))).toEqual(["rename", "duplicate"]);
    expect(ids(r.build({ ...ctx("node"), mode: "edit" }))).toEqual(["rename", "duplicate"]);
    expect(ids(r.build({ ...ctx("node"), mode: "live" }))).toEqual([
      "[Live]",
      "capacity.explain",
      "sim.inject",
      "---",
      "rename",
    ]);
  });

  it("live menus from the built-in actions keep only what makes sense mid-run", async () => {
    const { builtinActions } = await import("./builtinActions");
    const r = new ActionRegistry(builtinSections);
    r.register(builtinActions());
    const live = (target: ActionContext["target"]) =>
      r
        .build({ ...ctx(target), nodeId: "n", edgeId: "e", groupId: "g", mode: "live" })
        .flatMap((i) => (i.type === "item" ? [i.id] : []));
    expect(live("node")).toEqual(expect.arrayContaining(["node.rename", "node.properties"]));
    expect(live("node")).not.toContain("item.duplicate");
    expect(live("node")).not.toContain("item.delete");
    expect(live("edge")).toEqual(expect.arrayContaining(["edge.edit-label", "node.properties"]));
    expect(live("edge")).not.toContain("edge.reverse");
    expect(live("canvas")).toEqual(expect.arrayContaining(["canvas.properties"]));
    // Exporting is the File menu's and the app's own Export ▸ (src/interop/useInterop.tsx), which marks a private
    // diagram's file "private": true. The editor has no export of its own that could skip it.
    expect(live("canvas")).not.toContain("canvas.export");
    expect(live("canvas")).not.toContain("canvas.add-node");
  });

  it("palette-only actions stay out of context menus but reach the command palette", async () => {
    const { builtinActions } = await import("./builtinActions");
    const r = new ActionRegistry(builtinSections);
    r.register(builtinActions());
    const items = (surface?: "menu" | "palette") =>
      r.build({ ...ctx("canvas"), surface }).flatMap((i) => (i.type === "item" ? [i.id] : []));
    // Each has an always-visible canvas control and a shortcut.
    for (const id of ["canvas.fit", "canvas.undo", "canvas.redo", "canvas.shortcuts"]) {
      expect(items()).not.toContain(id);
      expect(items("palette")).toContain(id);
    }
    // The canvas menu stays well under its 12-item budget, with room for the next feature.
    expect(items().length).toBeLessThanOrEqual(9);
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
    expect(ids(r.build(ctx("node")))).toEqual(["rename", "---", "[Live]", "sim.inject"]);
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

describe("Run simulations on the canvas right-click and in Ctrl+K", () => {
  it("only while editing a diagram with saved simulations: opens the Checks card and plays, or stops a run", async () => {
    const { builtinActions } = await import("./builtinActions");
    const { checksPanel } = await import("../canvas/checks/checksPanel");
    const { setEditingRuns } = await import("../canvas/checks/editingRuns");
    const r = new ActionRegistry(builtinSections);
    r.register(builtinActions());
    let simulations: unknown[] | undefined = [{ id: "s", title: "Rush" }];
    const editor = {
      getDiagram: () => ({ nodes: [{ id: "a" }, { id: "b" }], edges: [], simulations }),
    } as unknown as EditorApi;
    const menu = (surface?: "menu" | "palette", mode?: "edit" | "live") =>
      r.build({ ...ctx("canvas"), editor, surface, mode }).flatMap((i) => (i.type === "item" ? [i] : []));
    const item = (surface?: "menu" | "palette", mode?: "edit" | "live") =>
      menu(surface, mode).find((i) => i.id === "canvas.run-simulations");
    let running = false;
    const runs = {
      isRunning: () => running,
      start: vi.fn(() => void (running = true)),
      stop: vi.fn(() => {
        const was = running;
        running = false;
        return was;
      }),
    };
    // Opening the card notes what had focus: no page here.
    vi.stubGlobal("HTMLElement", function HTMLElement() {});
    checksPanel.setAvailable(true);
    try {
      // No editing canvas's runs (the HTML viewer, an embed, read-only): nothing.
      expect(item()).toBeUndefined();
      setEditingRuns(runs);
      expect(item()).toMatchObject({ label: "Run simulations", icon: "bolt" });
      expect(item("palette")).toMatchObject({ label: "Run simulations" });
      // Right after Check diagram, and the canvas menu stays within its 12 rows.
      const ids = menu().map((i) => i.id);
      expect(ids.indexOf("canvas.run-simulations")).toBe(ids.indexOf("canvas.check-diagram") + 1);
      expect(ids.length).toBeLessThanOrEqual(10);
      // Never in live view's menus, nor where checks don't apply (presenting, live), nor without simulations.
      expect(item(undefined, "live")).toBeUndefined();
      checksPanel.setAvailable(false);
      expect(item("palette")).toBeUndefined();
      checksPanel.setAvailable(true);
      simulations = [];
      expect(item("palette")).toBeUndefined();
      simulations = [{ id: "s", title: "Rush" }];

      // It opens the Checks card, then plays them there.
      expect(checksPanel.isOpen()).toBe(false);
      item("palette")!.run!();
      expect(checksPanel.isOpen()).toBe(true);
      expect(runs.start).toHaveBeenCalledTimes(1);
      // While they play it's Stop, which stops them and leaves the card open.
      expect(item()).toMatchObject({ label: "Stop simulations" });
      item()!.run!();
      expect(runs.stop).toHaveBeenCalled();
      expect(running).toBe(false);
      expect(runs.start).toHaveBeenCalledTimes(1);
      expect(checksPanel.isOpen()).toBe(true);
      // The card already open: it plays again, in place.
      item()!.run!();
      expect(runs.start).toHaveBeenCalledTimes(2);

      // Leaving editing clears them; another canvas's clear leaves these alone.
      setEditingRuns(null, { isRunning: () => false, start() {}, stop: () => false });
      expect(item()).toBeDefined();
      setEditingRuns(null, runs);
      expect(item()).toBeUndefined();
    } finally {
      setEditingRuns(null);
      checksPanel.setAvailable(false);
      vi.unstubAllGlobals();
    }
  });
});
