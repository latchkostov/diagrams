import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decide, initialPolicy } from "./panePolicy";
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
        { type: "mode.changed", mode: "live" },
        settled({ covered: true }),
      ],
      [FIT("mode")],
    ],
    [
      "P2 live view leaves panel refits to Live",
      state({ mode: "live" }),
      [{ type: "pane.changed", cause: "panel" }, settled()],
      [],
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
    [
      "N1 narration takes the view",
      state(),
      [{ type: "narration", focus: true }, { type: "pane.changed", cause: "panel" }, settled()],
      [],
    ],
  ])("%s", (_name, start, events, expected) => {
    expect(run(start, events).commands).toEqual(expected);
  });

  it("selection reveals never change the owner", () => {
    for (const cause of ["selection", "placement"] as const) {
      const out = run(state(), [{ type: "pane.changed", cause }, settled({ selection: true, covered: true })]);
      expect(out.state.owner).toBe("fit");
    }
  });

  it("records the latest pane change's cause for Live", () => {
    expect(run(state({ mode: "live" }), [{ type: "pane.changed", cause: "selection" }]).state.lastCause).toBe(
      "selection",
    );
    expect(run(state({ mode: "live" }), [{ type: "pane.changed", cause: "panel" }]).state.lastCause).toBe("panel");
  });
});

// ---------------------------------------------------------------- the invariant cross-product

const OWNERS: CameraOwner[] = ["fit", "manual", "narration"];
const CAUSES: PaneCause[] = ["panel", "selection", "placement"];
const MENUS: (MenuKind | null)[] = [null, "context", "quickAdd"];
const MODES: CameraMode[] = ["edit", "live", "present"];
const BOOLS = [false, true];

describe("panePolicy: invariants over every owner, cause, menu, selection, coverage, mode and Shift+2", () => {
  const cases: {
    owner: CameraOwner;
    cause: PaneCause;
    menu: MenuKind | null;
    selection: boolean;
    covered: boolean;
    mode: CameraMode;
    zoomPriority: boolean;
  }[] = [];
  for (const owner of OWNERS)
    for (const cause of CAUSES)
      for (const menu of MENUS)
        for (const selection of BOOLS)
          for (const covered of BOOLS)
            for (const mode of MODES)
              for (const zoomPriority of BOOLS)
                cases.push({ owner, cause, menu, selection, covered, mode, zoomPriority });

  it("covers the whole cross-product", () => expect(cases).toHaveLength(3 * 3 * 3 * 2 * 2 * 3 * 2));

  it.each(cases)(
    "$owner $cause menu=$menu selected=$selection covered=$covered $mode shift2=$zoomPriority",
    ({ owner, cause, menu, selection, covered, mode, zoomPriority }) => {
      const facts = settled({ selection, covered, coveredWithEdges: covered, centreOff: covered });
      let s = state({ owner, mode, zoomPriority, menu });
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
      // No refit or zoom after a selection or placement cause; selections never change the owner.
      if (cause !== "panel") {
        expect(all.every((c) => c.type === "reveal")).toBe(true);
        expect(s.owner).toBe(owner);
      }
      // A refit only for panel work in edit mode with the view owned by Fit.
      const fits = all.filter((c) => c.type === "fit");
      expect(fits.length).toBe(cause === "panel" && owner === "fit" && mode === "edit" ? 1 : 0);
      // Zoom to selection's priority suppresses every reveal and centre.
      if (zoomPriority) expect(all.some((c) => c.type === "reveal" || c.type === "center")).toBe(false);
      // Reveals only when covered, and never while presenting.
      if (all.some((c) => c.type === "reveal")) {
        expect(covered).toBe(true);
        expect(mode).not.toBe("present");
      }
      // Live refits its own panels.
      if (mode !== "edit" && cause === "panel") expect(all).toEqual([]);
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
  fc.constantFrom(...MODES).map((mode) => ({ type: "mode.changed", mode }) as const),
  fc.constant({ type: "fullscreen.changed" } as const),
  fc.constant({ type: "overlay.opened" } as const),
  fc.boolean().map((focus) => ({ type: "narration", focus }) as const),
  fc
    .constantFrom("selection", "placement", "navigation", "checks" as const)
    .map((cause) => ({ type: "reveal.requested", cause }) as const),
  factsArb.map((f) => ({ type: "pane.settled", ...f }) as const),
);

describe("panePolicy: event sequences", () => {
  it("never decides more than one command, and pending work runs exactly once unless superseded", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        let s = initialPolicy();
        // The model: the pane work in force, and whether it has run.
        let work: { cause: PaneCause; ran: number } | null = null;
        for (const e of events) {
          const before = s;
          const d = decide(s, e);
          expect(d.commands.length).toBeLessThanOrEqual(1);
          const [command] = d.commands;
          if (e.type === "pane.settled" && before.pending && !before.menu) {
            // Replay: decided with the owner, mode and priority at replay time.
            expect(work).not.toBeNull();
            work!.ran++;
            expect(work!.ran).toBe(1);
            const refit = before.pending.cause === "panel" && before.owner === "fit" && before.mode === "edit";
            expect(command?.type === "fit").toBe(refit);
            // No refit after a selection or placement cause.
            if (before.pending.cause !== "panel") expect(command?.type ?? "reveal").toBe("reveal");
            if (before.zoomPriority && !refit) expect(command).toBeUndefined();
            work = null;
          } else if (e.type === "pane.settled") expect(d.commands).toEqual([]);
          // Superseded (replaced or cleared) work is a new item, or none.
          if (d.state.pending && d.state.pending !== before.pending) work = { cause: d.state.pending.cause, ran: 0 };
          if (!d.state.pending && e.type !== "pane.settled") work = null;
          // A menu never runs pending work.
          if (before.menu && command && e.type === "pane.settled") throw new Error("ran under a menu");
          // Zoom to selection's priority holds until an input or a move.
          if (before.zoomPriority && command && (command.type === "reveal" || command.type === "center"))
            throw new Error("a reveal overrode Zoom to selection");
          // Selections and placements never take or give up the view.
          if (e.type === "selection.changed" || e.type === "reveal.requested" || e.type === "pane.changed")
            expect(d.state.owner).toBe(before.owner);
          s = d.state;
        }
        // Closing any menu and letting the pane settle always finishes the work in force.
        const end = run(s, [{ type: "menu.closed" }, settled(), settled()]);
        expect(end.state.pending).toBeNull();
        expect(end.commands.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});
