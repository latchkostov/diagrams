import { describe, expect, it } from "vitest";
import { machinePaths } from "../../lib/machine";
import { createInteractionController, type InteractionPort } from "./controller";
import { editorModeMachine, editorModeStep, initialEditorMode, type EditorModeEvent } from "./mode";

const play = (events: EditorModeEvent[]) => events.reduce(editorModeStep, initialEditorMode);

describe("editor mode", () => {
  it("opens and closes menus, back to where they began", () => {
    expect(play([{ type: "menu.opened", kind: "context" }]).value).toBe("menu");
    expect(play([{ type: "menu.opened", kind: "quickAdd" }]).value).toBe("quickAdd");
    expect(play([{ type: "menu.opened", kind: "connected" }, { type: "menu.closed" }]).value).toBe("editing");
    const fromField = play([
      { type: "field.focused", field: "rate" },
      { type: "menu.opened", kind: "context" },
      { type: "menu.closed" },
    ]);
    expect(fromField).toMatchObject({ value: "field", field: "rate", resume: null });
  });

  it("names a node from quick-add: the pick's name field takes over from the menu", () => {
    const s = play([
      { type: "menu.opened", kind: "connected" },
      // Focus moves into quick-add's own search: not an Inspector field, so the mode stays.
      { type: "field.left" },
      { type: "menu.closed" },
      { type: "field.focused", target: "service-1" },
    ]);
    expect(s).toMatchObject({ value: "naming", target: "service-1" });
    expect(editorModeStep(s, { type: "naming.done" })).toMatchObject({ value: "editing", target: null });
    expect(editorModeStep(s, { type: "field.left" }).value).toBe("editing");
  });

  it("a name field's focus arriving while quick-add is still open ends the menu's mode too", () => {
    const s = play([
      { type: "menu.opened", kind: "quickAdd" },
      { type: "field.focused", target: "n1" },
    ]);
    expect(s).toMatchObject({ value: "naming", target: "n1", resume: null });
    // The menu's close after it changes nothing.
    expect(editorModeStep(s, { type: "menu.closed" })).toBe(s);
  });

  it("keeps Live and the selection as a region beside the mode", () => {
    const s = play([
      { type: "field.focused", target: "a" },
      { type: "live", state: "playing" },
      { type: "selection", ids: ["a"] },
    ]);
    expect(s).toMatchObject({ value: "naming", live: "playing", selection: ["a"] });
    expect(editorModeStep(s, { type: "live", state: "playing" })).toBe(s);
    expect(editorModeStep(s, { type: "selection", ids: ["a"] })).toBe(s);
    expect(editorModeStep(s, { type: "live", state: "off" }).live).toBe("off");
  });

  it("carries the open annotation editor as committed, beside the mode, and the controller sets it before the selection", () => {
    const s = play([
      { type: "annotating", id: "t1" },
      { type: "field.focused", target: "t1" },
    ]);
    expect(s).toMatchObject({ value: "naming", target: "t1", annotating: "t1" });
    expect(editorModeStep(s, { type: "annotating", id: "t1" })).toBe(s);
    const closed = editorModeStep(editorModeStep(s, { type: "field.left" }), { type: "annotating", id: null });
    expect(closed).toMatchObject({ value: "editing", annotating: null });
    expect(editorModeStep(initialEditorMode, { type: "annotating", id: null })).toBe(initialEditorMode);
    const port = {
      active: () => null,
      resolve: () => ({ state: "gone" }),
      focus: () => false,
      connected: () => true,
      publish: () => {},
    } as unknown as InteractionPort;
    const controller = createInteractionController(port, { frame: () => () => {}, microtask: (run) => run() });
    const seen: { annotating?: string | null; selection: readonly string[] }[] = [];
    controller.subscribeMode((mode) => seen.push({ annotating: mode.annotating, selection: mode.selection }));
    controller.selectionCommitted(JSON.stringify(["t1"]), false, "t1");
    expect(seen).toEqual([
      { annotating: "t1", selection: [] },
      { annotating: "t1", selection: ["t1"] },
    ]);
  });

  it("returns a gesture to its mode, and ignores what doesn't apply", () => {
    const s = play([{ type: "gesture.started" }]);
    expect(s.value).toBe("gesture");
    // Focus noise during a drag doesn't change it.
    expect(editorModeStep(s, { type: "field.left" })).toBe(s);
    expect(editorModeStep(s, { type: "gesture.ended" }).value).toBe("editing");
    expect(editorModeStep(initialEditorMode, { type: "menu.closed" })).toBe(initialEditorMode);
    expect(editorModeStep(initialEditorMode, { type: "naming.done" })).toBe(initialEditorMode);
  });

  it("keeps its invariants on every representative path", () => {
    const paths = machinePaths(editorModeMachine, { maxDepth: 4 });
    expect(new Set(paths.map((p) => p.state.value))).toEqual(
      new Set(["editing", "menu", "quickAdd", "gesture", "naming", "field"]),
    );
    for (const { state } of paths) {
      // A target only while naming; a field only while in a field; a way back only from a menu or a gesture.
      expect(state.target !== null).toBe(state.value === "naming");
      expect(state.field !== null).toBe(state.value === "field");
      if (state.resume) expect(["menu", "quickAdd", "gesture"]).toContain(state.value);
      else expect(["menu", "quickAdd", "gesture"]).not.toContain(state.value);
    }
  });

  it("is fed by the controller from what it already decides, and tells its transitions", () => {
    const label = { name: "label" };
    const button = { name: "button" };
    const port: InteractionPort = {
      active: () => null,
      resolve: () => ({ state: "gone" }),
      focus: () => false,
      connected: () => true,
      publish: () => {},
      field: (el) => (el === label ? { target: "n1" } : null),
    };
    const controller = createInteractionController(port, { frame: () => () => {}, microtask: (run) => run() });
    const seen: string[] = [];
    controller.subscribeMode((mode, previous) => seen.push(`${previous.value}>${mode.value}`));
    controller.openMenu("connected", null);
    controller.closeMenu("pick");
    controller.focusArrived(label);
    expect(controller.mode).toMatchObject({ value: "naming", target: "n1" });
    controller.dispatch({ type: "naming.done", flowId: "n1" });
    controller.focusArrived(button);
    controller.live("playing");
    expect(seen).toEqual([
      "editing>quickAdd",
      "quickAdd>editing",
      "editing>naming",
      "naming>editing",
      "editing>editing",
    ]);
    expect(controller.mode).toMatchObject({ value: "editing", live: "playing" });
  });
});
