import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { describe as say, focusPolicy, initialFocus, pendingMove } from "./focusPolicy";
import type {
  FocusCommand,
  FocusEvent,
  FocusMove,
  FocusState,
  MenuCloseReason,
  Platform,
  SelectionCause,
  SurfaceKind,
} from "./types";

const invoker = { name: "invoker" };
const opener = { name: "opener" };
const node = { name: "node" };
const state = (patch: Partial<FocusState> = {}): FocusState => ({ ...initialFocus(), ...patch });
const closed = (
  reason: MenuCloseReason,
  o: { kind?: SurfaceKind; invoker?: object | null; platform?: Platform } = {},
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
  it.each<[string, FocusState, FocusEvent[], string[]]>([
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
      ["focus:node:a@frame"],
    ],
    [
      "K2 Ctrl+Alt+] to a connection: focus it next frame",
      state(),
      [selected("keyboard", { target: { kind: "edge", id: "e1" } })],
      ["focus:edge:e1@frame"],
    ],
    [
      "H1 Undo from the canvas: focus what it selected, once drawn",
      state(),
      [selected("undo", { selection: { nodes: ["a"], edges: [] }, origin: "canvas" })],
      ["focus:selection@ready"],
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
      ["focus:selection@ready"],
    ],
    [
      "P1 the palette adds a node: focus it once drawn",
      state(),
      [selected("palette", { target: { kind: "node", id: "n" }, placed: true })],
      ["focus:node:n@ready"],
    ],
    [
      "P2 the palette goes to a node: focus it now",
      state(),
      [selected("palette", { target: { kind: "node", id: "n" } })],
      ["focus:node:n@now"],
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
      "I3 the Inspector opened by its control or with the selection: keep",
      state(),
      [
        { type: "inspector.toggled", cause: "panel" },
        { type: "inspector.toggled", cause: "selection" },
      ],
      ["keep", "keep"],
    ],
    [
      "D1 the Checks card closed: focus goes to its opener",
      state(),
      [{ type: "dialog.closed", dialog: "checks", opener }],
      ["focus:element@now"],
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
  "unmount",
];
const KINDS: SurfaceKind[] = ["context", "quickAdd", "connected", "dialog"];
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
    { type: "dialog.closed", dialog: "checks", opener },
    { type: "dialog.closed", dialog: "checks", opener: null },
    { type: "escape", from: node },
    { type: "escape", from: null },
    { type: "canvas.requested" },
    { type: "presenting" },
    { type: "start.blank" },
    { type: "dependencies.hidden", focusOnDependency: true },
    { type: "dependencies.hidden", focusOnDependency: false },
    { type: "document.replaced", active: node },
    { type: "document.replaced", active: null },
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
      expect(["keep", "focus", "roving"]).toContain(d.command.type);
      // The platform is an input that no row reads differently.
      expect(say(focusPolicy(s, onMac).command)).toBe(say(d.command));
      // A move is the one pending move; keep and roving leave pending as it was (unless the event retires it).
      if (d.command.type === "focus") expect(d.state.pending).toBe(d.command);
      else if (!["focus.ran", "focus.done", "input"].includes(e.type)) expect(d.state.pending).toBe(s.pending);
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
