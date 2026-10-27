import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { describe as say, focusPolicy, initialFocus, pendingMove } from "./focusPolicy";
import type {
  FocusCommand,
  FocusEvent,
  FocusMove,
  FocusState,
  LiveKey,
  LiveKeyAction,
  MenuCloseReason,
  Platform,
  SelectionCause,
  MenuFocusKind,
} from "./types";

const invoker = { name: "invoker" };
const opener = { name: "opener" };
const node = { name: "node" };
const state = (patch: Partial<FocusState> = {}): FocusState => ({ ...initialFocus(), ...patch });
const closed = (
  reason: MenuCloseReason,
  o: { kind?: MenuFocusKind; invoker?: object | null; platform?: Platform } = {},
): FocusEvent => ({
  type: "menu.closed",
  kind: o.kind ?? "context",
  reason,
  invoker: o.invoker === undefined ? invoker : o.invoker,
  platform: o.platform ?? "other",
});
const selected = (cause: SelectionCause, extra: Partial<Extract<FocusEvent, { type: "selection.changed" }>> = {}) =>
  ({ type: "selection.changed", cause, ...extra }) as FocusEvent;

/** Runs events from `start`, returning the final state and every command, in order. */
function run(start: FocusState, events: readonly FocusEvent[]) {
  let s = start;
  const commands: FocusCommand[] = [];
  for (const e of events) {
    const d = focusPolicy(s, e);
    s = d.state;
    commands.push(d.command);
  }
  return { state: s, commands };
}

describe("focusPolicy: the rules, row by row", () => {
  it("T1 opens the library when ready and returns Escape to its rail opener", () => {
    expect(focusPolicy(state(), { type: "tool.focus", cause: "library" }).command).toMatchObject({
      target: { kind: "paletteSearch" },
      when: "ready",
    });
    expect(focusPolicy(state(), { type: "tool.focus", cause: "escape", target: opener }).command).toMatchObject({
      target: { kind: "element", handle: opener },
      when: "now",
    });
    expect(focusPolicy(state(), { type: "tool.focus", cause: "select" }).command).toMatchObject({
      target: { kind: "canvas" },
      when: "now",
    });
  });
  it.each<[string, FocusState, FocusEvent[], string[]]>([
    [
      "I7 picker navigation focuses its mounted control now",
      state(),
      [{ type: "inspector.control", target: opener }],
      ["focus:element@now"],
    ],
    [
      "I4 removing a processor rule focuses its surviving control after the commit",
      state(),
      [{ type: "inspector.rule", target: opener }],
      ["focus:element@commit"],
    ],
    [
      "I5 changing a rule's incoming type focuses the control in its new row after the commit",
      state(),
      [{ type: "inspector.rule", target: opener }],
      ["focus:element@commit"],
    ],
    ["M1 Esc in a menu gives focus back to its invoker", state(), [closed("escape")], ["focus:element@commit"]],
    ["M2 a pick gives focus back only if the action left it lost", state(), [closed("pick")], ["focus:element@commit"]],
    ["M2 a press outside: the same", state(), [closed("outside")], ["focus:element@commit"]],
    ["M3 a menu opened with nothing focused: keep", state(), [closed("escape", { invoker: null })], ["keep"]],
    ["M3 the shortcuts dialog gives focus back itself", state(), [closed("escape", { kind: "dialog" })], ["keep"]],
    [
      "M4 opening a menu: the menu takes focus itself",
      state(),
      [{ type: "menu.opened", kind: "context", via: "pointer", platform: "mac" }],
      ["keep"],
    ],
    [
      "K1 Tab to a node: focus it next frame",
      state(),
      [selected("keyboard", { target: { kind: "node", id: "a" } })],
      ["focus:node:a@measured"],
    ],
    [
      "K2 Ctrl+Alt+] to a connection: focus it next frame",
      state(),
      [selected("keyboard", { target: { kind: "edge", id: "e1" } })],
      ["focus:edge:e1@measured"],
    ],
    [
      "H1 Undo from the canvas: focus what it selected, once drawn",
      state(),
      [selected("undo", { selection: { nodes: ["a"], edges: [] }, origin: "canvas" })],
      ["focus:selection@measured"],
    ],
    [
      "H2 Undo from the toolbar: focus stays, the Tab stop moves",
      state(),
      [selected("undo", { selection: { nodes: ["a"], edges: [] }, origin: "elsewhere" })],
      ["roving:selection@frame"],
    ],
    [
      "H1 Redo from the canvas: the same as Undo",
      state(),
      [selected("redo", { selection: { nodes: [], edges: ["e"] }, origin: "canvas" })],
      ["focus:selection@measured"],
    ],
    [
      "P1 the palette adds a node: focus it once drawn",
      state(),
      [selected("palette", { target: { kind: "node", id: "n" }, placed: true })],
      ["focus:node:n@measured"],
    ],
    [
      "P2 the palette goes to a node: focus it when visible",
      state(),
      [selected("palette", { target: { kind: "node", id: "n" } })],
      ["focus:node:n@ready"],
    ],
    ["S1 a click selects: focus stays", state(), [selected("click")], ["keep"]],
    ["S1 the selection box: focus stays", state(), [selected("box")], ["keep"]],
    ["S1 a placement (its name takes focus by I1): focus stays", state(), [selected("placement")], ["keep"]],
    ["S1 a menu's command selects: focus stays", state(), [selected("programmatic")], ["keep"]],
    [
      "N1 Enter in a new node's name: focus goes to its canvas node",
      state(),
      [{ type: "naming.done", flowId: "a" }],
      ["focus:item:a@now"],
    ],
    [
      "I1 F2: the Label field, once mounted for its node",
      state(),
      [{ type: "inspector.field", seq: 1, name: "label", owner: "a" }],
      ["focus:field:label@ready"],
    ],
    [
      "I2 the same request again (the Inspector folded and opened): keep",
      state(),
      [
        { type: "inspector.field", seq: 1, name: "label" },
        { type: "focus.done" },
        { type: "inspector.field", seq: 1, name: "label" },
      ],
      ["focus:field:label@ready", "keep", "keep"],
    ],
    [
      "I3 the Inspector control follows its replacement; selection keeps focus",
      state(),
      [
        { type: "inspector.toggled", cause: "panel" },
        { type: "inspector.toggled", cause: "selection" },
      ],
      ["focus:inspectorToggle@commit", "keep"],
    ],
    [
      "I4 a field request abandoned (Esc in its pending rename): nothing pending, focus stays",
      state(),
      [
        { type: "inspector.field", seq: 1, name: "label", owner: "e" },
        { type: "inspector.abandoned" },
        { type: "inspector.abandoned" },
      ],
      ["focus:field:label@ready", "keep", "keep"],
    ],
    [
      "D1 the Checks card closed: focus goes to its opener",
      state(),
      [{ type: "dialog.closed", dialog: "checks", opener }],
      ["focus:element@now"],
    ],
    [
      "M5 Esc in a Live popover gives focus back to its invoker at once",
      state(),
      [closed("escape", { kind: "live" })],
      ["focus:element@now"],
    ],
    [
      "M5 a Live popover opened with no invoker (the ⋯ menu): keep",
      state(),
      [closed("escape", { kind: "live", invoker: null })],
      ["keep"],
    ],
    [
      "M6 a pick, a press outside, its own button or the bar going: focus stays where it went",
      state(),
      [
        closed("pick", { kind: "live" }),
        closed("outside", { kind: "live" }),
        closed("toggle", { kind: "live" }),
        closed("unmount", { kind: "live" }),
      ],
      ["keep", "keep", "keep", "keep"],
    ],
    [
      "M4 a Live popover opening: keep",
      state(),
      [{ type: "menu.opened", kind: "live", via: "keyboard", platform: "other" }],
      ["keep"],
    ],
    [
      "D2 a Live panel's Esc: focus goes to its opener",
      state(),
      [{ type: "dialog.closed", dialog: "livePanel", opener, reason: "escape" }],
      ["focus:element@now"],
    ],
    [
      "D2 no opener: the Live bar's panel opener",
      state(),
      [{ type: "dialog.closed", dialog: "livePanel", opener: null, reason: "escape" }],
      ["focus:panelOpener@now"],
    ],
    [
      "D3 the inject dialog closed: focus goes to its opener",
      state(),
      [{ type: "dialog.closed", dialog: "inject", opener, node: "inventory", reason: "pick" }],
      ["focus:element@now"],
    ],
    [
      "D3 no opener (the menu item it came from has gone): the node it injects at",
      state(),
      [{ type: "dialog.closed", dialog: "inject", opener: null, node: "inventory", reason: "escape" }],
      ["focus:node:inventory@now"],
    ],
    [
      "L1 Space, Enter and Esc in live view never move focus, at any level",
      state(),
      [
        { type: "live.key", key: "escape", action: "selection" },
        { type: "live.key", key: "escape", action: "trace" },
        { type: "live.key", key: "escape", action: "path" },
        { type: "live.key", key: "escape", action: "exit" },
        { type: "live.key", key: "space", action: "toggle" },
        { type: "live.key", key: "enter", action: "resume" },
      ],
      ["keep", "keep", "keep", "keep", "keep", "keep"],
    ],
    [
      "L2 a pausing note while presenting: its Continue now",
      state(),
      [{ type: "narration.waiting", resume: node }],
      ["focus:element@now"],
    ],
    [
      "L3 a callout that had focus went: the canvas if lost",
      state(),
      [{ type: "callout.closed", hadFocus: true }],
      ["focus:canvas@now"],
    ],
    ["L3 a callout without focus went: keep", state(), [{ type: "callout.closed", hadFocus: false }], ["keep"]],
    [
      "L4 a new entry point's rate: once its panel lists it",
      state(),
      [{ type: "panel.field", panel: "capacity-panel", field: "capacity-rate-n1" }],
      ["focus:panelField:capacity-rate-n1@ready"],
    ],
    [
      "D1 no opener: the canvas",
      state(),
      [{ type: "dialog.closed", dialog: "checks", opener: null }],
      ["focus:canvas@now"],
    ],
    [
      "E1 Esc on a node: back on it two frames later if lost",
      state(),
      [{ type: "escape", from: node }],
      ["focus:element@frames2"],
    ],
    ["E1 Esc from nowhere in the canvas: keep", state(), [{ type: "escape", from: null }], ["keep"]],
    [
      "C1 the gallery hands over: the canvas next frame",
      state(),
      [{ type: "canvas.requested" }],
      ["focus:canvas@frame"],
    ],
    ["C2 presenting: the canvas if lost", state(), [{ type: "presenting" }], ["focus:canvas@now"]],
    ["C3 Start blank: the stencil search", state(), [{ type: "start.blank" }], ["focus:paletteSearch@frame"]],
    [
      "C4 hiding the focused dependency: the canvas",
      state(),
      [{ type: "dependencies.hidden", focusOnDependency: true }],
      ["focus:canvas@now"],
    ],
    [
      "C4 hiding dependencies, focus elsewhere: keep",
      state(),
      [{ type: "dependencies.hidden", focusOnDependency: false }],
      ["keep"],
    ],
    [
      "R1 a peer removed what had focus: the canvas next frame",
      state(),
      [{ type: "document.replaced", active: node }],
      ["focus:canvas@frame"],
    ],
    ["R1 a peer's change, focus elsewhere: keep", state(), [{ type: "document.replaced", active: null }], ["keep"]],
    [
      "F2 a field's second attempt follows the first",
      state(),
      [{ type: "inspector.field", seq: 1, name: "label" }, { type: "focus.ran" }, { type: "focus.ran" }],
      ["focus:field:label@ready", "focus:field:label@frame", "keep"],
    ],
    [
      "F4 input stands the second attempt down",
      state(),
      [{ type: "inspector.field", seq: 1, name: "label" }, { type: "focus.ran" }, { type: "input" }],
      ["focus:field:label@ready", "focus:field:label@frame", "keep"],
    ],
  ])("%s", (_name, start, events, expected) => {
    expect(run(start, events).commands.map(say)).toEqual(expected);
  });

  it("M1 Esc falls back to the canvas, and never waits for focus to be lost", () => {
    const c = focusPolicy(state(), closed("escape")).command as FocusMove;
    expect(c.target).toEqual({ kind: "element", handle: invoker });
    expect(c.fallback).toEqual({ kind: "canvas" });
    expect(c.onlyIfLost).toBeUndefined();
  });

  it("M2 a pick, an outside press or a scroll yields to whatever the action focused", () => {
    for (const reason of ["pick", "outside", "scroll", "blur", "resize", "gesture", "command"] as const) {
      const c = focusPolicy(state(), closed(reason)).command as FocusMove;
      expect(c.onlyIfLost).toBe(true);
      expect(c.fallback).toBeUndefined();
    }
  });

  it("D2 and D3 fall back to the panel opener and the node, never the canvas", () => {
    const panel = focusPolicy(state(), { type: "dialog.closed", dialog: "livePanel", opener }).command as FocusMove;
    const inject = focusPolicy(state(), { type: "dialog.closed", dialog: "inject", opener, node: "n" })
      .command as FocusMove;
    expect(panel.fallback).toEqual({ kind: "panelOpener" });
    expect(inject.fallback).toEqual({ kind: "node", id: "n" });
  });

  it("D4 and D5 focus a modal's first field and wrap its Tab through the controller", () => {
    const opened = focusPolicy(state(), { type: "dialog.opened", first: opener }).command as FocusMove;
    expect(opened).toMatchObject({ target: { kind: "element", handle: opener }, when: "now", select: "all" });
    const tab = focusPolicy(state(), { type: "dialog.tab", target: invoker }).command as FocusMove;
    expect(tab).toMatchObject({ target: { kind: "element", handle: invoker }, when: "now" });
    expect(tab.select).toBeUndefined();
  });

  it("L3 yields to a move someone else made; L4 selects the field's text and doesn't go again", () => {
    const callout = focusPolicy(state(), { type: "callout.closed", hadFocus: true }).command as FocusMove;
    const field = focusPolicy(state(), { type: "panel.field", panel: "p", field: "f" }).command as FocusMove;
    expect(callout.onlyIfLost).toBe(true);
    expect(focusPolicy(state(), { type: "callout.closed", hadFocus: true, undo: true }).command).toMatchObject({
      target: { kind: "canvas" },
      when: "commit",
      onlyIfLost: true,
    });
    expect([field.select, field.again]).toEqual(["all", undefined]);
  });

  it("K1 moves the Tab stop at once; F1 a node focused by a click moves it too", () => {
    expect(run(state(), [selected("keyboard", { target: { kind: "node", id: "b" } })]).state.roving).toBe("b");
    expect(run(state({ roving: "b" }), [{ type: "focus.entered", id: "c" }]).state.roving).toBe("c");
    expect(run(state(), [{ type: "focus.resolved", id: "d" }]).state.roving).toBe("d");
  });

  it("K1 and H1 bring their target into view themselves (no focus reveal on top)", () => {
    const k = focusPolicy(state(), selected("keyboard", { target: { kind: "node", id: "a" } })).command as FocusMove;
    const h = focusPolicy(state(), selected("undo", { selection: { nodes: [], edges: [] }, origin: "canvas" }))
      .command as FocusMove;
    const n = focusPolicy(state(), { type: "naming.done", flowId: "a" }).command as FocusMove;
    expect([k.revealed, h.revealed, n.revealed]).toEqual([true, true, undefined]);
  });

  it("I1 selects all of the name, or puts the caret at its end when a name was typed first", () => {
    const all = focusPolicy(state(), { type: "inspector.field", seq: 1, name: "label" }).command as FocusMove;
    const end = focusPolicy(state(), { type: "inspector.field", seq: 1, name: "label", caret: "end" })
      .command as FocusMove;
    expect([all.select, end.select]).toEqual(["all", "end"]);
    expect(all.again).toBe(true);
  });

  it("M7 a peer deleting a context menu's target hands the keyboard to the canvas, only if it was lost", () => {
    for (const kind of ["context", "quickAdd", "connected"] as const)
      expect(say(focusPolicy(state(), closed("remote", { kind })).command)).toBe("focus:canvas@commit");
    expect((focusPolicy(state(), closed("remote")).command as FocusMove).onlyIfLost).toBe(true);
    expect(focusPolicy(state(), closed("remote", { kind: "live" })).command).toEqual({ type: "keep" });
  });

  it("D6 a room's dialog gives focus back to its opener, else the canvas", () => {
    const d = focusPolicy(state(), { type: "dialog.closed", dialog: "room", opener });
    expect(d.command).toMatchObject({ target: { kind: "element", handle: opener }, when: "now" });
    expect((d.command as FocusMove).fallback).toEqual({ kind: "canvas" });
  });

  it("T5 T6 T7 Tab steps into a readout card, or out of one past the last node", () => {
    const target = { kind: "node" as const, id: "a" };
    expect(focusPolicy(state(), { type: "readout.entered", target, opening: false }).command).toEqual({
      type: "focus",
      target: { kind: "readout", item: "node", id: "a" },
      when: "now",
    });
    expect(focusPolicy(state(), { type: "readout.entered", target, opening: true }).command).toEqual({
      type: "focus",
      target: { kind: "readout", item: "node", id: "a" },
      when: "commit",
      fallback: target,
    });
    expect(focusPolicy(state(), { type: "readout.left", target }).command).toEqual({
      type: "focus",
      target,
      when: "now",
    });
  });

  it("T8 T9 only Esc on a pinned readout gives focus back to its item", () => {
    const target = { kind: "edge" as const, id: "e", pinned: true };
    expect(say(focusPolicy(state(), { type: "readout.closed", target, reason: "escape" }).command)).toBe(
      "focus:edge:e@now",
    );
    for (const reason of ["outside", "unmount", "command"] as const)
      expect(focusPolicy(state(), { type: "readout.closed", target, reason }).command).toEqual({ type: "keep" });
    expect(
      focusPolicy(state(), { type: "readout.closed", target: { ...target, pinned: false }, reason: "escape" }).command,
    ).toEqual({ type: "keep" });
  });

  it("restores Esc focus for an unpinned card that had focus without claiming it was pinned", () => {
    const target = { kind: "node" as const, id: "a", pinned: false };
    expect(
      say(focusPolicy(state(), { type: "readout.closed", target, hadFocus: true, reason: "escape" }).command),
    ).toBe("focus:node:a@now");
    expect(focusPolicy(state(), { type: "readout.closed", target, hadFocus: true, reason: "outside" }).command).toEqual(
      { type: "keep" },
    );
  });

  it("L6 timeline arrows focus the selected event", () => {
    expect(focusPolicy(state(), { type: "node.details", source: "timeline", target: opener }).command).toMatchObject({
      target: { kind: "element", handle: opener },
      when: "now",
    });
  });

  it("D7 Tab from a live node enters its scrollable details", () => {
    expect(focusPolicy(state(), { type: "node.details", target: opener }).command).toMatchObject({
      target: { kind: "element", handle: opener },
      when: "now",
    });
  });

  it("recovers focused readouts to the canvas when their target is removed, leaving unrelated focus alone", () => {
    for (const kind of ["node", "edge"] as const) {
      const event = {
        type: "readout.closed" as const,
        reason: "remote" as const,
        target: { kind, id: "removed", pinned: true },
      };
      expect(focusPolicy(state(), { ...event, hadFocus: true }).command).toMatchObject({
        target: { kind: "canvas" },
        when: "now",
      });
      expect(focusPolicy(state(), { ...event, hadFocus: false }).command).toEqual({ type: "keep" });
    }
  });

  it("W1 W2 the joiner's wait and then the room's canvas take only focus that was lost", () => {
    const wait = focusPolicy(state(), { type: "room.waiting", region: node }).command as FocusMove;
    expect(wait).toMatchObject({ target: { kind: "element", handle: node }, when: "now", onlyIfLost: true });
    const ready = focusPolicy(state(), { type: "room.ready" }).command as FocusMove;
    expect(ready).toMatchObject({ target: { kind: "canvas" }, when: "frame", onlyIfLost: true });
  });

  it("W3 W4 Retry hands focus to the room's status; any other change is only announced", () => {
    const retry = focusPolicy(state(), { type: "room.status", state: "waiting", retry: true, status: node });
    expect(retry.command).toMatchObject({ target: { kind: "element", handle: node }, when: "now" });
    for (const s of ["connected", "waiting", "failed"])
      expect(focusPolicy(state(), { type: "room.status", state: s, retry: false, status: node }).command).toEqual({
        type: "keep",
      });
  });

  it("F2 the second attempt neither selects the text again nor counts as pending", () => {
    const r = run(state(), [{ type: "inspector.field", seq: 1, name: "label", caret: "end" }, { type: "focus.ran" }]);
    const retry = r.commands[1] as FocusMove;
    expect(retry.select).toBeUndefined();
    expect(retry.retry).toBe(true);
    expect(pendingMove(r.state)).toBeNull();
  });
});

// ---------------------------------------------------------------- the invariant cross-product

const REASONS: MenuCloseReason[] = [
  "pick",
  "escape",
  "outside",
  "scroll",
  "replaced",
  "blur",
  "resize",
  "gesture",
  "command",
  "toggle",
  "unmount",
  "remote",
];
const KINDS: MenuFocusKind[] = ["context", "quickAdd", "connected", "dialog", "live"];
const LIVE_KEYS: LiveKey[] = ["space", "enter", "escape"];
const LIVE_ACTIONS: LiveKeyAction[] = [
  "slowmo",
  "recording",
  "editor",
  "owner",
  "canvas",
  "selection",
  "trace",
  "presentation",
  "path",
  "exit",
  "toggle",
  "resume",
  "repeat",
  "close-readout",
  "pin-readout",
  "none",
];
const PLATFORMS: Platform[] = ["mac", "other"];
const CAUSES: SelectionCause[] = ["click", "box", "keyboard", "undo", "redo", "placement", "palette", "programmatic"];

/** Every event, over its inputs (the platform as one of them). */
function allEvents(platform: Platform): FocusEvent[] {
  const events: FocusEvent[] = [];
  for (const kind of KINDS)
    for (const reason of REASONS)
      for (const inv of [invoker, null]) events.push(closed(reason, { kind, invoker: inv, platform }));
  for (const kind of KINDS)
    for (const via of ["pointer", "keyboard"] as const) events.push({ type: "menu.opened", kind, via, platform });
  for (const cause of CAUSES)
    for (const target of [undefined, { kind: "node" as const, id: "a" }, { kind: "edge" as const, id: "e" }])
      for (const origin of [undefined, "canvas" as const, "elsewhere" as const])
        for (const placed of [undefined, true])
          for (const selection of [undefined, { nodes: ["a"], edges: ["e"] }])
            events.push(selected(cause, { target, origin, placed, selection }));
  events.push(
    { type: "naming.done", flowId: "a" },
    { type: "inspector.field", seq: 1, name: "label" },
    { type: "inspector.field", seq: 9, name: "sublabel", caret: "end", owner: "a" },
    { type: "inspector.toggled", cause: "panel" },
    { type: "inspector.toggled", cause: "selection" },
    { type: "inspector.abandoned" },
    { type: "dialog.closed", dialog: "checks", opener },
    { type: "dialog.closed", dialog: "checks", opener: null },
    { type: "dialog.closed", dialog: "room", opener },
    { type: "dialog.closed", dialog: "room", opener: null },
    { type: "room.waiting", region: node },
    { type: "room.ready" },
    { type: "room.status", state: "waiting", retry: true, status: node },
    { type: "room.status", state: "connected", retry: false, status: node },
    ...(["livePanel", "inject"] as const).flatMap((dialog) =>
      [opener, null].flatMap((o) =>
        REASONS.map((reason): FocusEvent => ({ type: "dialog.closed", dialog, opener: o, node: "n", reason })),
      ),
    ),
    ...LIVE_KEYS.flatMap((key) => LIVE_ACTIONS.map((action): FocusEvent => ({ type: "live.key", key, action }))),
    { type: "narration.waiting", resume: node },
    { type: "callout.closed", hadFocus: true },
    { type: "callout.closed", hadFocus: false },
    { type: "panel.field", panel: "capacity-panel", field: "rate" },
    { type: "escape", from: node },
    { type: "escape", from: null },
    { type: "canvas.requested" },
    { type: "presenting" },
    { type: "start.blank" },
    { type: "dependencies.hidden", focusOnDependency: true },
    { type: "dependencies.hidden", focusOnDependency: false },
    { type: "document.replaced", active: node },
    { type: "document.replaced", active: null },
    ...(["node", "edge"] as const).flatMap((kind): FocusEvent[] => [
      { type: "readout.entered", target: { kind, id: "r" }, opening: false },
      { type: "readout.entered", target: { kind, id: "r" }, opening: true },
      { type: "readout.left", target: { kind, id: "r" } },
      ...REASONS.flatMap((reason) =>
        [true, false].map((pinned): FocusEvent => ({
          type: "readout.closed",
          target: { kind, id: "r", pinned },
          reason,
        })),
      ),
    ]),
    { type: "focus.entered", id: "b" },
    { type: "focus.resolved", id: "c" },
    { type: "focus.ran" },
    { type: "focus.done" },
    { type: "input" },
  );
  return events;
}

const PENDING: (FocusMove | null)[] = [
  null,
  { type: "focus", target: { kind: "node", id: "x" }, when: "frame" },
  { type: "focus", target: { kind: "field", name: "label" }, when: "ready", again: true },
  { type: "focus", target: { kind: "field", name: "label" }, when: "frame", retry: true },
];
const STATES: FocusState[] = PENDING.flatMap((pending) =>
  [undefined, "r"].flatMap((roving) => [0, 5].map((fieldSeq) => ({ pending, roving, fieldSeq }))),
);
const MOVING_CAUSES = new Set<SelectionCause>(["keyboard", "undo", "redo", "palette"]);

describe("focusPolicy: invariants over every state × event", () => {
  const cases = STATES.flatMap((s) => allEvents("other").map((e, i) => [s, e, allEvents("mac")[i]] as const));

  it(`holds for all ${cases.length} cases`, () => {
    expect(cases.length).toBeGreaterThan(5000);
    for (const [s, e, onMac] of cases) {
      const d = focusPolicy(s, e);
      // Exactly one focus command per event.
      expect(["keep", "focus", "roving", "recover"]).toContain(d.command.type);
      // The platform is an input that no row reads differently.
      expect(say(focusPolicy(s, onMac).command)).toBe(say(d.command));
      // A move is the one pending move; keep and roving leave pending as it was (unless the event retires it).
      if (d.command.type === "focus") expect(d.state.pending).toBe(d.command);
      else if (e.type === "inspector.abandoned")
        expect(d.state.pending).toBe(s.pending?.target.kind === "field" ? null : s.pending);
      else if (!["focus.ran", "focus.done", "input"].includes(e.type)) expect(d.state.pending).toBe(s.pending);
      if (d.command.type === "recover") {
        expect(e.type).toBe("document.replaced");
        expect(s.pending).not.toBeNull();
        expect(s.pending?.ifGone).toBeUndefined();
        expect(d.command.onlyIfLost).toBe(true);
        expect(d.state.pending).toBe(s.pending);
      }
      // Esc always gives focus back to the invoker (a menu's; a dialog gives it back itself).
      if (e.type === "menu.closed" && e.reason === "escape" && e.invoker && e.kind !== "dialog") {
        const c = d.command as FocusMove;
        expect(c.type).toBe("focus");
        expect(c.target).toEqual({ kind: "element", handle: e.invoker });
        expect(c.fallback).toEqual({ kind: "canvas" });
      }
      // Every other close never takes focus from something an action or a press focused.
      if (e.type === "menu.closed" && e.reason !== "escape" && d.command.type === "focus")
        expect(d.command.onlyIfLost).toBe(true);
      // Selection moves focus only from the keyboard, a history step on the canvas, or the palette.
      if (e.type === "selection.changed" && !MOVING_CAUSES.has(e.cause)) expect(d.command.type).toBe("keep");
      // Undo from the toolbar (or anywhere off the canvas) never moves focus.
      if (e.type === "selection.changed" && (e.cause === "undo" || e.cause === "redo") && e.origin !== "canvas")
        expect(d.command.type).not.toBe("focus");
      // A move to something that can disappear says where focus goes instead, or only acts if focus was lost.
      if (d.command.type === "focus" && ["element", "selection"].includes(d.command.target.kind))
        expect(!!d.command.fallback || !!d.command.onlyIfLost).toBe(true);
      // A readout drawn by a later commit always says where focus goes if it never appears: its own item.
      if (d.command.type === "focus" && d.command.target.kind === "readout" && d.command.when !== "now")
        expect(d.command.fallback).toEqual({ kind: d.command.target.item, id: d.command.target.id });
      // Live's keys never move focus, at any level; a Live popover gives focus back only on Esc.
      if (e.type === "live.key") expect(d.command.type).toBe("keep");
      if (e.type === "menu.closed" && e.kind === "live" && e.reason !== "escape") expect(d.command.type).toBe("keep");
      // A peer's deletion of a menu's target never takes focus from what someone else focused.
      if (e.type === "menu.closed" && e.reason === "remote" && d.command.type === "focus") {
        expect(d.command.target).toEqual({ kind: "canvas" });
        expect(d.command.onlyIfLost).toBe(true);
      }
      // A room's state changing moves focus only for Retry, onto its status.
      if (e.type === "room.status" && !e.retry) expect(d.command.type).toBe("keep");
      // A dialog or panel closing always says where focus goes if its opener has gone.
      if (e.type === "dialog.closed") expect((d.command as FocusMove).fallback).toBeDefined();
      // Inspector requests run once each.
      expect(d.state.fieldSeq).toBeGreaterThanOrEqual(s.fieldSeq);
    }
  });
});

// ---------------------------------------------------------------- event sequences

const arbEvent: fc.Arbitrary<FocusEvent> = fc.oneof(
  fc
    .tuple(fc.constantFrom(...REASONS), fc.constantFrom(...KINDS), fc.boolean(), fc.constantFrom(...PLATFORMS))
    .map(([reason, kind, has, platform]) => closed(reason, { kind, invoker: has ? invoker : null, platform })),
  fc
    .tuple(fc.constantFrom(...CAUSES), fc.constantFrom("a", "b", "c"), fc.boolean(), fc.boolean())
    .map(([cause, id, edge, canvas]) =>
      selected(cause, {
        target: { kind: edge ? "edge" : "node", id },
        selection: { nodes: [id], edges: [] },
        origin: canvas ? "canvas" : "elsewhere",
      }),
    ),
  fc
    .integer({ min: 1, max: 6 })
    .map((seq): FocusEvent => ({ type: "inspector.field", seq, name: "label", owner: "a" })),
  fc.constantFrom<FocusEvent>(
    { type: "live.key", key: "escape", action: "trace" },
    { type: "dialog.closed", dialog: "livePanel", opener, reason: "escape" },
    { type: "panel.field", panel: "capacity-panel", field: "rate" },
    { type: "focus.ran" },
    { type: "focus.done" },
    { type: "input" },
    { type: "escape", from: node },
    { type: "naming.done", flowId: "a" },
    { type: "focus.entered", id: "c" },
  ),
);

describe("focusPolicy: event sequences (menus × selection × focus × undo)", () => {
  it("one command per event; the roving stop follows the last node focus went to; field requests run once", () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 60 }), (events) => {
        let s = initialFocus();
        let roving: string | undefined;
        const taken = new Set<number>();
        for (const e of events) {
          const d = focusPolicy(s, e);
          if (e.type === "selection.changed" && e.cause === "keyboard" && e.target?.kind === "node")
            roving = e.target.id;
          if (e.type === "focus.entered") roving = e.id;
          expect(d.state.roving).toBe(roving);
          if (e.type === "inspector.field" && d.command.type === "focus") {
            expect(taken.has(e.seq)).toBe(false);
            taken.add(e.seq);
            for (const t of taken) expect(e.seq).toBeGreaterThanOrEqual(t);
          }
          // A second attempt only ever follows the first attempt of a move that asked for one.
          if (d.command.type === "focus" && d.command.retry) {
            expect(e.type).toBe("focus.ran");
            expect(s.pending?.again).toBe(true);
          }
          s = d.state;
        }
      }),
    );
  });

  it("a newer move always replaces the pending one (at most one pending)", () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 60 }), (events) => {
        let s = initialFocus();
        for (const e of events) {
          const d = focusPolicy(s, e);
          if (d.command.type === "focus") expect(d.state.pending).toEqual(d.command);
          s = d.state;
        }
      }),
    );
  });
});

it.each<MenuFocusKind>(["context", "live", "dialog"])(
  "delayed narration preserves focus while a %s menu is open",
  (kind) => {
    const opened: FocusEvent = { type: "menu.opened", kind, via: "keyboard", platform: "other" };
    const waiting: FocusEvent = { type: "narration.waiting", resume: node };
    const r = run(state(), [opened, waiting]);
    expect(r.commands).toEqual([{ type: "keep" }, { type: "keep" }]);
    const resumed = run(r.state, [closed("escape", { kind }), waiting]);
    expect(resumed.commands.at(-1)).toMatchObject({ type: "focus", target: { kind: "element", handle: node } });
  },
);

it("narration waits for both independently opened Live popovers to close", () => {
  const opened: FocusEvent = { type: "menu.opened", kind: "live", via: "pointer", platform: "other" };
  const waiting: FocusEvent = { type: "narration.waiting", resume: node };
  const r = run(state(), [opened, opened, closed("outside", { kind: "live" }), waiting]);
  expect(r.commands.at(-1)).toEqual({ type: "keep" });
  expect(run(r.state, [closed("outside", { kind: "live" }), waiting]).commands.at(-1)).toMatchObject({
    type: "focus",
    target: { kind: "element", handle: node },
  });
});

describe("gesture ending focus rows", () => {
  it.each(["drop", "escape", "cancel", "blur", "unmount", "superseded"] as const)("keeps focus for %s", (reason) => {
    expect(focusPolicy(state(), { type: "gesture.ended", kind: "edge.end", reason }).command).toEqual({ type: "keep" });
  });
  it("recovers remote loss only if focus is lost", () => {
    expect(focusPolicy(state(), { type: "gesture.ended", kind: "edge.end", reason: "remote" }).command).toEqual({
      type: "recover",
      target: { kind: "canvas" },
      when: "frame",
      onlyIfLost: true,
    });
  });
});
