import { describe, expect, it } from "vitest";
import { machinePaths, machineStep } from "../../lib/machine";
import { createInteractionController, type InteractionPort } from "./controller";
import { editorModeMachine, editorModeStep, initialEditorMode, type EditorModeEvent } from "./mode";

const play = (events: EditorModeEvent[]) => events.reduce(editorModeStep, initialEditorMode);

describe("editor mode", () => {
  // Every cell of the buffered handover table, including all non-handover modes and wrong-owner guards.
  for (const value of editorModeMachine.states) {
    for (const type of ["naming.accepted", "naming.committed", "naming.focused", "naming.cancelled"] as const) {
      it.each(["a", "stale"])(`${value} + ${type} (%s) follows the handover table`, (target) => {
        const state = {
          ...initialEditorMode,
          value,
          target: ["naming", "committing", "released"].includes(value) ? "a" : null,
        };
        const next = machineStep(editorModeMachine, state, { type, target, request: 0 });
        const expected =
          target !== "a"
            ? undefined
            : type === "naming.cancelled" && ["naming", "committing", "released"].includes(value)
              ? "editing"
              : value === "naming" && type === "naming.accepted"
                ? "committing"
                : value === "committing" && type === "naming.committed"
                  ? "released"
                  : value === "released" && type === "naming.focused"
                    ? "editing"
                    : undefined;
        expect(next.accepted).toBe(expected !== undefined);
        expect(next.state.value).toBe(expected ?? value);
        expect(next.commands).toEqual(
          expected === "committing"
            ? [{ type: "naming.commit", target: "a", request: 0 }]
            : expected === "released"
              ? [
                  { type: "naming.release", target: "a", request: 0 },
                  { type: "naming.focus", target: "a", request: 0 },
                ]
              : [],
        );
        if (!expected) expect(next.state).toBe(state);
      });
    }
  }

  it("commit noise cannot interrupt the commit; a released owner yields to normal interactions", () => {
    const state = play([
      { type: "naming.requested", target: "a" },
      { type: "naming.accepted", target: "a" },
    ]);
    for (const event of editorModeMachine.events) {
      if (event.type.startsWith("naming.")) continue;
      expect(editorModeStep(state, event)).toBe(state);
    }
    const released = editorModeStep(state, { type: "naming.committed", target: "a" });
    expect(editorModeStep(released, { type: "field.left" })).toBe(released);
    for (const event of [
      { type: "menu.opened", kind: "connected" },
      { type: "gesture.started" },
      { type: "field.focused", field: "rate" },
      { type: "naming.requested", target: "b" },
    ] as const) {
      const next = editorModeStep(released, event);
      expect(next.value).not.toBe("released");
      expect(editorModeStep(next, { type: "naming.focused", target: "a", request: released.namingRequest })).toBe(next);
    }
  });

  it("a late focus completion for the same target cannot finish its next naming request", () => {
    const released = play([
      { type: "naming.requested", target: "a" },
      { type: "naming.accepted", target: "a" },
      { type: "naming.committed", target: "a" },
    ]);
    const next = editorModeStep(released, { type: "naming.requested", target: "a" });
    const again = editorModeStep(editorModeStep(next, { type: "naming.accepted", target: "a" }), {
      type: "naming.committed",
      target: "a",
    });
    expect(editorModeStep(again, { type: "naming.focused", target: "a", request: released.namingRequest })).toBe(again);
    expect(editorModeStep(again, { type: "naming.focused", target: "a", request: again.namingRequest }).value).toBe(
      "editing",
    );
  });
  it.each(["off", "playing", "paused"] as const)("node double-click decides Properties from Live region %s", (live) => {
    const state = { ...initialEditorMode, live };
    const result = machineStep(editorModeMachine, state, { type: "node.doubleClicked", target: "n1" });
    expect(result.state).toMatchObject({
      value: live === "off" ? "naming" : "editing",
      target: live === "off" ? "n1" : null,
    });
    expect(result.commands).toEqual([
      { type: "node.properties", target: "n1", ...(live === "off" ? { field: "label" } : {}) },
    ]);
    const port: InteractionPort = {
      active: () => null,
      resolve: () => ({ state: "gone" }),
      focus: () => false,
      connected: () => true,
      publish: () => {},
    };
    const controller = createInteractionController(port, { frame: () => () => {}, microtask: (run) => run() });
    controller.live(live);
    const opened: (string | undefined)[] = [];
    controller.nodeDoubleClick("n1", (field) => opened.push(field));
    expect(opened).toEqual([live === "off" ? "label" : undefined]);
    expect(controller.mode).toMatchObject(result.state);
  });
  it("enters naming before the field downloads and finishes when pending input ends", () => {
    const pending = play([{ type: "naming.requested", target: "e" }]);
    expect(pending).toMatchObject({ value: "naming", target: "e" });
    expect(editorModeStep(pending, { type: "naming.done" })).toMatchObject({ value: "editing", target: null });
  });

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
      new Set(["editing", "menu", "quickAdd", "gesture", "naming", "committing", "released", "field"]),
    );
    for (const { state } of paths) {
      // A target only while naming; a field only while in a field; a way back only from a menu or a gesture.
      expect(state.target !== null).toBe(["naming", "committing", "released"].includes(state.value));
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
