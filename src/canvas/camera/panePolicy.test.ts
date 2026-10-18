import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decide, initialPolicy, waitsForMenu } from "./panePolicy";
import type {
  CameraCommand,
  CameraEvent,
  CameraMode,
  CameraOwner,
  MenuKind,
  PaneCause,
  PolicyState,
  SettledFacts,
} from "./types";

const settled = (facts: Partial<SettledFacts> = {}): CameraEvent => ({
  type: "pane.settled",
  selection: false,
  covered: false,
  coveredWithEdges: false,
  centreOff: false,
  ...facts,
});
const state = (patch: Partial<PolicyState> = {}): PolicyState => ({ ...initialPolicy(), ...patch });
/** Runs events from `start`, returning the final state and every command, in order. */
function run(start: PolicyState, events: readonly CameraEvent[]) {
  let s = start;
  const commands: CameraCommand[] = [];
  for (const e of events) {
    const d = decide(s, e);
    s = d.state;
    commands.push(...d.commands);
  }
  return { state: s, commands };
}

const FIT = (reason: string) => ({ type: "fit", reason });
const ROOM = { panel: false, card: false, focus: [] as readonly string[] };
const LIVE = (reason: string, room: Partial<typeof ROOM> = {}) => ({
  type: "liveFit",
  reason,
  panel: false,
  card: false,
  ...room,
});
const NOTE = (reason: string, focus: string[], room: Partial<typeof ROOM> = {}) => ({
  type: "noteFit",
  reason,
  focus,
  panel: false,
  card: false,
  ...room,
});
const V = { x: 1, y: 2, zoom: 0.8 };
const REVEAL = (cause: string, withEdges = false) => ({ type: "reveal", cause, withEdges });

describe("panePolicy: the agreed rules, row by row", () => {
  it.each<[string, PolicyState, CameraEvent[], unknown[]]>([
    // A panel-driven pane change with no new selection refits a fitted view.
    [
      "P1/R1 panel toggle, fitted view: refit",
      state(),
      [{ type: "pane.changed", cause: "panel" }, settled()],
      [FIT("pane")],
    ],
    [
      "P1/R1 panel toggle with something selected (toolbar control): still a refit",
      state(),
      [{ type: "pane.changed", cause: "panel" }, settled({ selection: true, covered: true, coveredWithEdges: true })],
      [FIT("pane")],
    ],
    // Selection and placement opens never refit or zoom; they pan only when covered.
    [
      "S1/R3 selection open, covered: reveal",
      state(),
      [{ type: "pane.changed", cause: "selection" }, settled({ selection: true, covered: true })],
      [REVEAL("selection")],
    ],
    [
      "S1/R4 selection open, not covered: the camera holds still",
      state(),
      [{ type: "pane.changed", cause: "selection" }, settled({ selection: true })],
      [],
    ],
    [
      "S1/R3 placement open, covered: reveal the placed item",
      state(),
      [{ type: "pane.changed", cause: "placement" }, settled({ selection: true, covered: true })],
      [REVEAL("placement")],
    ],
    [
      "S1/R4 placement open in view: nothing",
      state(),
      [{ type: "pane.changed", cause: "placement" }, settled({ selection: true })],
      [],
    ],
    // (b) A placement while a panel refit is pending drops the refit and reveals only the placed item.
    [
      "S2 (b) placement supersedes pending panel work",
      state(),
      [
        { type: "pane.changed", cause: "panel" },
        { type: "selection.changed", cause: "placement" },
        settled({ selection: true, covered: true, coveredWithEdges: true }),
      ],
      [REVEAL("placement")],
    ],
    [
      "S2 a selection with nothing pending changes nothing",
      state(),
      [{ type: "selection.changed", cause: "selection" }, settled({ selection: true, covered: true })],
      [],
    ],
    // Pending panel work survives menus opening and closing and runs once afterwards.
    [
      "M1/M2 a context menu defers the refit until it closes, then it runs once",
      state(),
      [
        { type: "pane.changed", cause: "panel" },
        { type: "menu.opened", kind: "context" },
        settled(),
        settled(),
        { type: "menu.closed" },
        { type: "menu.opened", kind: "context" },
        settled(),
        { type: "menu.closed" },
        settled(),
        settled(),
      ],
      [FIT("pane")],
    ],
    [
      "M2 quick-add dismissed without a pick counts as a menu: the refit runs",
      state(),
      [
        { type: "pane.changed", cause: "panel" },
        { type: "menu.opened", kind: "quickAdd" },
        { type: "menu.closed" },
        settled(),
      ],
      [FIT("pane")],
    ],
    [
      "M2 quick-add pick: the placement replaces the refit",
      state(),
      [
        { type: "pane.changed", cause: "panel" },
        { type: "menu.opened", kind: "quickAdd" },
        { type: "selection.changed", cause: "placement" },
        { type: "menu.closed" },
        settled({ selection: true }),
      ],
      [],
    ],
    // Replay uses the owner at replay time.
    [
      "R5 a menu-delayed refit after Shift+0 reveals instead (manual owner)",
      state(),
      [
        { type: "pane.changed", cause: "panel" },
        { type: "menu.opened", kind: "context" },
        { type: "menu.closed" },
        { type: "input" },
        { type: "zoom100" },
        settled({ selection: true, covered: true, coveredWithEdges: true }),
      ],
      [{ type: "zoom100" }, REVEAL("panel", true)],
    ],
    [
      "R5 manual owner, selection in view with its connections: nothing",
      state({ owner: "manual" }),
      [{ type: "pane.changed", cause: "panel" }, settled({ selection: true, covered: true })],
      [],
    ],
    [
      "R6 manual owner, nothing selected, centre past the edge: center",
      state({ owner: "manual" }),
      [{ type: "pane.changed", cause: "panel" }, settled({ centreOff: true })],
      [{ type: "center" }],
    ],
    [
      "R6 manual owner, nothing selected, centre in the pane: nothing",
      state({ owner: "manual" }),
      [{ type: "pane.changed", cause: "panel" }, settled()],
      [],
    ],
    [
      "R5 narration owner: reveal, never a refit",
      state({ owner: "narration" }),
      [{ type: "pane.changed", cause: "panel" }, settled({ selection: true, coveredWithEdges: true })],
      [REVEAL("panel", true)],
    ],
    // Zoom to selection wins over any deferred reveal.
    [
      "Z1/R2 Shift+2 then the Inspector opens: no reveal",
      state(),
      [
        { type: "input" },
        { type: "zoomToSelection" },
        { type: "pane.changed", cause: "selection" },
        settled({ selection: true, covered: true }),
      ],
      [{ type: "zoomToSelection" }],
    ],
    [
      "Z2 a reveal waiting for measurement gives way to Shift+2",
      state(),
      [{ type: "zoomToSelection" }, { type: "reveal.requested", cause: "placement" }],
      [{ type: "zoomToSelection" }],
    ],
    [
      "I1 a later input ends Shift+2's priority",
      state(),
      [{ type: "zoomToSelection" }, { type: "input" }, { type: "reveal.requested", cause: "navigation" }],
      [{ type: "zoomToSelection" }, REVEAL("navigation")],
    ],
    [
      "Z1 after Shift+2 the view is manual: a later panel change does not refit",
      state(),
      [
        { type: "zoomToSelection" },
        { type: "input" },
        { type: "pane.changed", cause: "panel" },
        settled({ selection: true }),
      ],
      [{ type: "zoomToSelection" }],
    ],
    // Keyboard-only Shift+0 and manual pan or zoom are owned by the user.
    ["U1 a pan by hand makes the view manual", state(), [{ type: "user.moved" }], []],
    [
      "U1 Shift+0 then a panel toggle keeps the zoom",
      state(),
      [{ type: "zoom100" }, { type: "pane.changed", cause: "panel" }, settled()],
      [{ type: "zoom100" }],
    ],
    // Commands and modes take the view back.
    [
      "F1 Fit view clears pending work and refits",
      state({ owner: "manual" }),
      [{ type: "pane.changed", cause: "panel" }, { type: "fit", reason: "command" }, settled()],
      [FIT("command")],
    ],
    [
      "F1 a mode change refits and drops pending work",
      state(),
      [
        { type: "pane.changed", cause: "selection" },
        { type: "mode.changed", mode: "live", live: true },
        settled({ covered: true }),
      ],
      [FIT("mode")],
    ],
    [
      "P1/L5 live view: a panel change refits a fitted view with Live's fit",
      state({ mode: "live" }),
      [{ type: "pane.changed", cause: "panel" }, settled()],
      [LIVE("pane")],
    ],
    [
      "P1/L6 live view: a panel change refits a narrated view to the note's focus",
      state({ mode: "live", owner: "narration", live: { ...ROOM, focus: ["a", "b"] } }),
      [{ type: "pane.changed", cause: "panel" }, settled({ selection: true, coveredWithEdges: true })],
      [NOTE("pane", ["a", "b"])],
    ],
    [
      "P1/L7 live view, manual: the selection and its connections only if covered",
      state({ mode: "live", owner: "manual" }),
      [{ type: "pane.changed", cause: "panel" }, settled({ selection: true, coveredWithEdges: true })],
      [REVEAL("panel", true)],
    ],
    [
      "P1/L7 live view, manual, nothing selected: no centring",
      state({ mode: "live", owner: "manual" }),
      [{ type: "pane.changed", cause: "panel" }, settled({ centreOff: true })],
      [],
    ],
    [
      "M1 live view: a menu defers live panel work",
      state({ mode: "live" }),
      [{ type: "pane.changed", cause: "panel" }, { type: "menu.opened", kind: "context" }, settled()],
      [],
    ],
    [
      "L1 a note's focus takes the view once the pane settles",
      state({ mode: "live", owner: "manual" }),
      [{ type: "narration", focus: ["a"] }, settled()],
      [NOTE("narration", ["a"])],
    ],
    [
      "L1 Live's work doesn't wait for a menu",
      state({ mode: "live" }),
      [{ type: "menu.opened", kind: "context" }, { type: "narration", focus: ["a"] }, settled()],
      [NOTE("narration", ["a"])],
    ],
    [
      "L1 a new note with the same focus takes the view again",
      state({ mode: "live" }),
      [
        { type: "narration", focus: ["a"] },
        settled(),
        { type: "user.moved" },
        { type: "narration", focus: ["a"] },
        settled(),
      ],
      [NOTE("narration", ["a"]), NOTE("narration", ["a"])],
    ],
    [
      "L2 a focused note ending gives the fit back",
      state({ mode: "live" }),
      [{ type: "narration", focus: ["a"] }, settled(), { type: "narration", focus: [] }, settled()],
      [NOTE("narration", ["a"]), LIVE("narration")],
    ],
    [
      "L2 a note without focus after none: nothing",
      state({ mode: "live", owner: "manual" }),
      [{ type: "narration", focus: [] }, settled()],
      [],
    ],
    [
      "L3/L5 the side panel opening refits a fitted view into what it leaves",
      state({ mode: "live" }),
      [{ type: "live.panel", open: true }, settled()],
      [LIVE("panel", { panel: true })],
    ],
    [
      "L3/L6 the side panel opening refits a narrated view to the focus, clear of it",
      state({ mode: "live", owner: "narration", live: { ...ROOM, focus: ["a"] } }),
      [{ type: "live.panel", open: true }, settled()],
      [NOTE("panel", ["a"], { panel: true })],
    ],
    [
      "L3/L8 the side panel keeps a manual view",
      state({ mode: "live", owner: "manual" }),
      [{ type: "live.panel", open: true }, settled({ selection: true, coveredWithEdges: true })],
      [],
    ],
    [
      "L3 the side panel already open: nothing",
      state({ mode: "live", live: { ...ROOM, panel: true } }),
      [{ type: "live.panel", open: true }, settled()],
      [],
    ],
    [
      "L3 a live panel change that came first stays (it also reveals for a manual view)",
      state({ mode: "live", owner: "manual" }),
      [
        { type: "pane.changed", cause: "panel" },
        { type: "live.panel", open: true },
        settled({ selection: true, coveredWithEdges: true }),
      ],
      [REVEAL("panel", true)],
    ],
    [
      "L3/L5 the trace card opening and closing refits (beside it while open)",
      state({ mode: "live" }),
      [{ type: "live.card", open: true }, settled(), { type: "live.card", open: false }, settled()],
      [LIVE("card", { card: true }), LIVE("card")],
    ],
    [
      "L3 the trace card under an open side panel: no refit (the panel's column covers its place)",
      state({ mode: "live", live: { ...ROOM, panel: true } }),
      [{ type: "live.card", open: true }, settled()],
      [],
    ],
    [
      "L3 the room is remembered: closing the panel later fits beside the open card",
      state({ mode: "live", live: { ...ROOM, panel: true } }),
      [{ type: "live.card", open: true }, { type: "live.panel", open: false }, settled()],
      [LIVE("panel", { card: true })],
    ],
    [
      "L4/L9 a node Live added comes into view clear of the panel, whoever owns the view",
      state({ mode: "live", owner: "manual" }),
      [{ type: "live.added", panel: true }, settled()],
      [LIVE("added", { panel: true })],
    ],
    [
      "S1 a pane change (the Inspector opening) doesn't drop slow motion's take",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "slowmo.take" },
        { type: "pane.changed", cause: "selection" },
        settled({ selection: true, covered: true }),
      ],
      [{ type: "slowmoPlan" }],
    ],
    [
      "P1 a panel change doesn't drop a node Live added (a manual view)",
      state({ mode: "live", owner: "manual" }),
      [{ type: "live.added", panel: false }, { type: "pane.changed", cause: "panel" }, settled()],
      [LIVE("added")],
    ],
    [
      "S1 a selection's pane change doesn't replace a note's fit",
      state({ mode: "live" }),
      [{ type: "narration", focus: ["a"] }, { type: "pane.changed", cause: "selection" }, settled({ covered: true })],
      [NOTE("narration", ["a"])],
    ],
    [
      "S2 a selection doesn't replace Live's work",
      state({ mode: "live" }),
      [
        { type: "narration", focus: ["a"] },
        { type: "selection.changed", cause: "selection" },
        settled({ covered: true }),
      ],
      [NOTE("narration", ["a"])],
    ],
    [
      "W1/W5 slow motion: a pane change asks it, following",
      state({ mode: "live" }),
      [{ type: "slowmo", on: true }, { type: "pane.changed", cause: "panel" }, settled()],
      [{ type: "slowmoPane", following: true }],
    ],
    [
      "W5 slow motion after a pan by hand: not following",
      state({ mode: "live" }),
      [{ type: "slowmo", on: true }, { type: "user.moved" }, { type: "pane.changed", cause: "panel" }, settled()],
      [{ type: "slowmoPane", following: false }],
    ],
    [
      "W3/W4 a take plans its camera once the pane settles, absorbing a pane change",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "slowmo.take" },
        { type: "pane.changed", cause: "panel" },
        settled(),
        settled(),
      ],
      [{ type: "slowmoPlan" }],
    ],
    [
      "W3 a take takes the view back after a pan by hand",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "user.moved" },
        { type: "slowmo.take" },
        settled(),
        { type: "slowmo.follow", view: V },
      ],
      [{ type: "slowmoPlan" }, { type: "follow", view: V }],
    ],
    [
      "W6 a pan by hand stops following",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "slowmo.follow", view: V },
        { type: "user.moved" },
        { type: "slowmo.follow", view: V },
      ],
      [{ type: "follow", view: V }],
    ],
    [
      "W6 following waits while the pane settles (a paused replay holds its view first)",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "pane.changed", cause: "panel" },
        { type: "slowmo.follow", view: V },
        settled(),
        { type: "slowmo.follow", view: V },
      ],
      [
        { type: "slowmoPane", following: true },
        { type: "follow", view: V },
      ],
    ],
    [
      "W6 no following outside slow motion",
      state({ mode: "live", owner: "slowmo" }),
      [{ type: "slowmo.follow", view: V }],
      [],
    ],
    [
      "W7 slow motion keeps its camera: narration, the panel, the card and additions only change the room",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "narration", focus: ["a"] },
        { type: "live.panel", open: true },
        { type: "live.card", open: true },
        { type: "live.added", panel: false },
        settled(),
      ],
      [],
    ],
    [
      "W3 presenting during slow motion keeps it and replans",
      state({ mode: "live" }),
      [{ type: "slowmo", on: true }, { type: "mode.changed", mode: "present", live: true }, settled()],
      [{ type: "slowmoPlan" }],
    ],
    [
      "W3 full screen during slow motion replans",
      state({ mode: "present" }),
      [{ type: "slowmo", on: true }, { type: "fullscreen.changed" }, settled()],
      [{ type: "slowmoPlan" }],
    ],
    [
      "W2 ending slow motion restores the view, and the view's owner from before",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "slowmo", on: false, restore: V },
        { type: "pane.changed", cause: "panel" },
        settled(),
      ],
      [{ type: "restore", view: V }, LIVE("pane")],
    ],
    [
      "W2 a pan by hand during slow motion keeps the view manual after it",
      state({ mode: "live" }),
      [
        { type: "slowmo", on: true },
        { type: "user.moved" },
        { type: "slowmo", on: false },
        { type: "live.panel", open: true },
        settled(),
      ],
      [],
    ],
    [
      "F4 leaving live view while presenting (L) ends slow motion: the normal fit, then full screen refits",
      state({ mode: "present", live: { ...ROOM, card: true } }),
      [
        { type: "slowmo", on: true },
        { type: "mode.changed", mode: "present", live: false },
        { type: "slowmo", on: false },
        { type: "fullscreen.changed" },
        settled(),
      ],
      [FIT("mode"), FIT("fullscreen")],
    ],
    [
      "F1 leaving live view ends slow motion and clears Live's room",
      state({ mode: "live", live: { ...ROOM, panel: true } }),
      [
        { type: "slowmo", on: true },
        { type: "mode.changed", mode: "edit", live: false },
        { type: "slowmo.follow", view: V },
      ],
      [FIT("mode")],
    ],
    [
      "S1 live view still reveals a covered selection",
      state({ mode: "live" }),
      [{ type: "pane.changed", cause: "selection" }, settled({ selection: true, covered: true })],
      [REVEAL("selection")],
    ],
    [
      "X1 presenting holds its fit",
      state({ mode: "present" }),
      [{ type: "pane.changed", cause: "selection" }, settled({ covered: true })],
      [],
    ],
    [
      "F2 full screen refits a fitted presentation",
      state({ mode: "present" }),
      [{ type: "fullscreen.changed" }],
      [FIT("fullscreen")],
    ],
    [
      "F2 full screen keeps a manual presentation",
      state({ mode: "present", owner: "manual" }),
      [{ type: "fullscreen.changed" }],
      [],
    ],
    ["F2 full screen outside presenting: nothing", state(), [{ type: "fullscreen.changed" }], []],
    ["F3 the Checks card refits a fitted view", state(), [{ type: "overlay.opened" }], [FIT("checks")]],
    ["F3 the Checks card keeps a manual view", state({ owner: "manual" }), [{ type: "overlay.opened" }], []],
  ])("%s", (_name, start, events, expected) => {
    expect(run(start, events).commands).toEqual(expected);
  });

  it("selection reveals never change the owner", () => {
    for (const cause of ["selection", "placement"] as const) {
      const out = run(state(), [{ type: "pane.changed", cause }, settled({ selection: true, covered: true })]);
      expect(out.state.owner).toBe("fit");
    }
  });
});

// ---------------------------------------------------------------- the invariant cross-product

const OWNERS: CameraOwner[] = ["fit", "manual", "narration", "slowmo"];
const CAUSES: PaneCause[] = ["panel", "selection", "placement"];
const MENUS: (MenuKind | null)[] = [null, "context", "quickAdd"];
const MODES: CameraMode[] = ["edit", "live", "present"];
const BOOLS = [false, true];

describe("panePolicy: invariants over every owner, cause, menu, selection, coverage, mode, Shift+2 and slow motion", () => {
  const cases: {
    owner: CameraOwner;
    cause: PaneCause;
    menu: MenuKind | null;
    selection: boolean;
    covered: boolean;
    mode: CameraMode;
    zoomPriority: boolean;
    slowmo: boolean;
  }[] = [];
  for (const owner of OWNERS)
    for (const cause of CAUSES)
      for (const menu of MENUS)
        for (const selection of BOOLS)
          for (const covered of BOOLS)
            for (const mode of MODES)
              for (const zoomPriority of BOOLS)
                for (const slowmo of BOOLS) {
                  // Slow motion runs in live view or presenting, and owns the view unless a pan by hand took it.
                  if (slowmo && mode === "edit") continue;
                  if (owner === "slowmo" && !slowmo) continue;
                  cases.push({ owner, cause, menu, selection, covered, mode, zoomPriority, slowmo });
                }

  it("covers the whole consistent cross-product", () =>
    expect(cases).toHaveLength(3 * 3 * 3 * 2 * 2 * 3 * 2 + 4 * 3 * 3 * 2 * 2 * 2 * 2));

  it.each(cases)(
    "$owner $cause menu=$menu selected=$selection covered=$covered $mode shift2=$zoomPriority slowmo=$slowmo",
    ({ owner, cause, menu, selection, covered, mode, zoomPriority, slowmo }) => {
      const facts = settled({ selection, covered, coveredWithEdges: covered, centreOff: covered });
      const live = { panel: false, card: false, focus: owner === "narration" ? ["a"] : [] };
      let s = state({ owner, mode, zoomPriority, menu, slowmo, live });
      const changed = decide(s, { type: "pane.changed", cause });
      expect(changed.commands).toEqual([]);
      s = changed.state;
      const steps: CameraEvent[] = [facts, ...(menu ? [{ type: "menu.closed" } as const] : []), facts, facts];
      const out: CameraCommand[][] = [];
      for (const e of steps) {
        const d = decide(s, e);
        // At most one command per event.
        expect(d.commands.length).toBeLessThanOrEqual(1);
        out.push(d.commands);
        s = d.state;
      }
      const all = out.flat();
      // Pending work runs at most once, and never while a menu is open.
      if (menu) expect(out[0]).toEqual([]);
      expect(all.length).toBeLessThanOrEqual(1);
      expect(s.pending).toBeNull();
      // The owner never changes on a pane change.
      expect(s.owner).toBe(owner);
      // No refit or zoom after a selection or placement cause.
      if (cause !== "panel") expect(all.every((c) => c.type === "reveal")).toBe(true);
      // The canvas's refit only for panel work in edit mode with the view owned by Fit.
      const fits = all.filter((c) => c.type === "fit");
      expect(fits.length).toBe(cause === "panel" && owner === "fit" && mode === "edit" ? 1 : 0);
      // Live's refit for panel work in live view: the whole diagram for Fit, the note's focus for narration.
      const live1 = cause === "panel" && mode === "live" && !slowmo;
      expect(all.filter((c) => c.type === "liveFit").length).toBe(live1 && owner === "fit" ? 1 : 0);
      expect(all.filter((c) => c.type === "noteFit").length).toBe(live1 && owner === "narration" ? 1 : 0);
      // Slow motion decides its own camera for panel work; nothing else does while it runs.
      const asked = all.filter((c) => c.type === "slowmoPane");
      expect(asked.length).toBe(cause === "panel" && slowmo && mode === "live" ? 1 : 0);
      if (slowmo) expect(all.every((c) => c.type === "slowmoPane" || c.type === "reveal")).toBe(true);
      // Zoom to selection's priority suppresses every reveal and centre.
      if (zoomPriority) expect(all.some((c) => c.type === "reveal" || c.type === "center")).toBe(false);
      // Reveals only when covered, and never while presenting.
      if (all.some((c) => c.type === "reveal")) {
        expect(covered).toBe(true);
        expect(mode).not.toBe("present");
      }
      // Live view never recentres (only the selection and its connections come into view).
      if (mode !== "edit") expect(all.some((c) => c.type === "center")).toBe(false);
    },
  );
});

// ---------------------------------------------------------------- event sequences (fast-check)

const factsArb = fc.record({
  selection: fc.boolean(),
  covered: fc.boolean(),
  coveredWithEdges: fc.boolean(),
  centreOff: fc.boolean(),
});
const viewArb = fc.record({ x: fc.integer({ min: -9, max: 9 }), y: fc.constant(0), zoom: fc.constant(1) });
const eventArb: fc.Arbitrary<CameraEvent> = fc.oneof(
  fc.constantFrom(...CAUSES).map((cause) => ({ type: "pane.changed", cause }) as const),
  fc.constantFrom("selection", "placement" as const).map((cause) => ({ type: "selection.changed", cause }) as const),
  fc.constantFrom<MenuKind>("context", "quickAdd").map((kind) => ({ type: "menu.opened", kind }) as const),
  fc.constant({ type: "menu.closed" } as const),
  fc.constant({ type: "input" } as const),
  fc.constant({ type: "user.moved" } as const),
  fc.constant({ type: "zoom100" } as const),
  fc.constant({ type: "zoomToSelection" } as const),
  fc.constantFrom("command", "reset" as const).map((reason) => ({ type: "fit", reason }) as const),
  fc
    .tuple(fc.constantFrom(...MODES), fc.boolean())
    .map(
      ([mode, live]) =>
        ({ type: "mode.changed", mode, live: mode === "live" || (mode === "present" && live) }) as const,
    ),
  fc.constant({ type: "fullscreen.changed" } as const),
  fc.constant({ type: "overlay.opened" } as const),
  fc.constantFrom([], ["a"], ["a", "b"]).map((focus) => ({ type: "narration", focus }) as const),
  fc.boolean().map((open) => ({ type: "live.panel", open }) as const),
  fc.boolean().map((open) => ({ type: "live.card", open }) as const),
  fc.boolean().map((panel) => ({ type: "live.added", panel }) as const),
  fc.tuple(fc.boolean(), fc.option(viewArb)).map(([on, restore]) => ({ type: "slowmo", on, restore }) as const),
  fc.constant({ type: "slowmo.take" } as const),
  viewArb.map((view) => ({ type: "slowmo.follow", view }) as const),
  fc
    .constantFrom("selection", "placement", "navigation", "checks" as const)
    .map((cause) => ({ type: "reveal.requested", cause }) as const),
  factsArb.map((f) => ({ type: "pane.settled", ...f }) as const),
);

/** Commands only slow motion's camera gives, and what may run while slow motion has the view. */
const SLOWMO = new Set(["slowmoPlan", "slowmoPane", "follow"]);
const WHILE_SLOWMO = new Set([...SLOWMO, "restore", "reveal", "fit", "zoom100", "zoomToSelection"]);

describe("panePolicy: event sequences", () => {
  it("never decides more than one command, and pending work runs exactly once unless superseded", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        let s = initialPolicy();
        // The model: the pane work in force, and whether it has run.
        let work: { cause: string; ran: number } | null = null;
        for (const e of events) {
          const before = s;
          const d = decide(s, e);
          expect(d.commands.length).toBeLessThanOrEqual(1);
          const [command] = d.commands;
          const deferred = before.menu && before.pending && waitsForMenu(before.pending);
          if (e.type === "pane.settled" && before.pending && !deferred) {
            // Replay: decided with the owner, mode and priority at replay time.
            expect(work).not.toBeNull();
            work!.ran++;
            expect(work!.ran).toBe(1);
            const cause = before.pending.cause;
            const refit = cause === "panel" && before.owner === "fit" && before.mode === "edit";
            expect(command?.type === "fit").toBe(refit);
            // No refit after a selection or placement cause.
            if (cause === "selection" || cause === "placement") expect(command?.type ?? "reveal").toBe("reveal");
            // Only Live's addition and slow motion's take move a view Zoom to selection owns.
            if (before.zoomPriority && !refit && cause !== "live.added" && cause !== "slowmo.take")
              expect(command).toBeUndefined();
            work = null;
          } else if (e.type === "pane.settled") expect(d.commands).toEqual([]);
          // Superseded (replaced or cleared) work is a new item, or none.
          if (d.state.pending && d.state.pending !== before.pending) work = { cause: d.state.pending.cause, ran: 0 };
          if (!d.state.pending && e.type !== "pane.settled") work = null;
          // A menu never runs the canvas's pane work.
          if (deferred && command && e.type === "pane.settled") throw new Error("ran under a menu");
          // Zoom to selection's priority holds until an input or a move.
          if (before.zoomPriority && command && (command.type === "reveal" || command.type === "center"))
            throw new Error("a reveal overrode Zoom to selection");
          // Selections and placements never take or give up the view.
          if (e.type === "selection.changed" || e.type === "reveal.requested" || e.type === "pane.changed")
            expect(d.state.owner).toBe(before.owner);
          // Slow motion owns the view only while it runs; its commands run only then; nothing else refits it.
          if (d.state.owner === "slowmo") expect(d.state.slowmo).toBe(true);
          if (command && SLOWMO.has(command.type)) expect(before.slowmo).toBe(true);
          if (command?.type === "follow") {
            expect(before.owner).toBe("slowmo");
            expect(before.pending).toBeNull();
          }
          if (before.slowmo && d.state.slowmo && command) expect(WHILE_SLOWMO.has(command.type)).toBe(true);
          if (command?.type === "fit" && before.slowmo) expect(command.reason).not.toBe("pane");
          // Live's fits only outside the canvas's edit mode or for its own work.
          if (command?.type === "noteFit") expect(command.focus.length).toBeGreaterThan(0);
          s = d.state;
        }
        // Closing any menu and letting the pane settle always finishes the work in force.
        const end = run(s, [{ type: "menu.closed" }, settled(), settled()]);
        expect(end.state.pending).toBeNull();
        expect(end.commands.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1000 },
    );
  });
});
