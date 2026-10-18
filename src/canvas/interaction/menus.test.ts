import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cameraMenuKind, initialMenus, menus } from "./menus";
import type { MenuCloseReason, MenusEvent, MenusState, CanvasSurfaceKind } from "./types";

const open = (kind: CanvasSurfaceKind = "context", invoker: object | null = null): MenusEvent<string> => ({
  type: "menu.open",
  kind,
  payload: kind,
  invoker,
  via: "pointer",
  platform: "other",
});
const close = (reason: MenuCloseReason, seq?: number): MenusEvent<string> => ({ type: "menu.close", reason, seq });

function run(events: MenusEvent<string>[], start: MenusState<string> = initialMenus()) {
  let s = start;
  const log: string[] = [];
  for (const e of events) {
    const t = menus(s, e);
    if (t.closed) log.push(`closed:${t.closed.kind}:${t.closed.reason}`);
    if (t.opened) log.push(`opened:${t.opened.kind}#${t.opened.seq}`);
    s = t.state;
  }
  return { state: s, log };
}

describe("menus: the lifecycle, row by row", () => {
  it.each<[string, MenusEvent<string>[], string[], CanvasSurfaceKind | null]>([
    ["O1 a right-click opens the context menu", [open()], ["opened:context#1"], "context"],
    [
      "C1 a pick closes it, with its reason",
      [open(), close("pick")],
      ["opened:context#1", "closed:context:pick"],
      null,
    ],
    ["C1 Esc closes it", [open("quickAdd"), close("escape")], ["opened:quickAdd#1", "closed:quickAdd:escape"], null],
    [
      "O2 a second right-click replaces the menu: replaced, then opened",
      [open(), open("connected")],
      ["opened:context#1", "closed:context:replaced", "opened:connected#2"],
      "connected",
    ],
    [
      "C2 the first menu's late listener (its seq) can't close the second",
      [open(), open("quickAdd"), close("blur", 1)],
      ["opened:context#1", "closed:context:replaced", "opened:quickAdd#2"],
      "quickAdd",
    ],
    [
      "C1 the open menu's own seq closes it",
      [open(), close("outside", 1)],
      ["opened:context#1", "closed:context:outside"],
      null,
    ],
    ["C3 a close with nothing open reports nothing", [close("scroll")], [], null],
    [
      "C3 a second close after the first reports nothing (one closed per menu)",
      [open(), close("pick"), close("escape")],
      ["opened:context#1", "closed:context:pick"],
      null,
    ],
  ])("%s", (_name, events, log, kind) => {
    const r = run(events);
    expect(r.log).toEqual(log);
    expect(r.state.open?.kind ?? null).toBe(kind);
  });

  it("keeps the invoker it opened with, for Esc to give focus back to", () => {
    const node = {};
    const r = menus(initialMenus<string>(), open("context", node));
    expect(r.state.open?.invoker).toBe(node);
    expect(menus(r.state, close("escape")).closed?.invoker).toBe(node);
  });

  it("feeds the camera its two kinds; a dialog isn't a camera menu", () => {
    expect(cameraMenuKind("context")).toBe("context");
    expect(cameraMenuKind("quickAdd")).toBe("quickAdd");
    expect(cameraMenuKind("connected")).toBe("quickAdd");
    expect(cameraMenuKind("dialog")).toBeNull();
    expect(cameraMenuKind(undefined)).toBeNull();
  });
});

describe("menus: event sequences", () => {
  const kinds = fc.constantFrom<CanvasSurfaceKind>("context", "quickAdd", "connected", "dialog");
  const reasons = fc.constantFrom<MenuCloseReason>(
    "pick",
    "escape",
    "outside",
    "scroll",
    "blur",
    "resize",
    "gesture",
    "command",
    "unmount",
    "remote",
  );
  const event = fc.oneof(
    kinds.map(open),
    fc.tuple(reasons, fc.option(fc.integer({ min: 1, max: 8 }), { nil: undefined })).map(([r, s]) => close(r, s)),
  );

  it("every open is closed exactly once, at most one is open, and seqs only grow", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        let s = initialMenus<string>();
        const opened = new Set<number>();
        const closed = new Set<number>();
        for (const e of events) {
          const t = menus(s, e);
          if (t.closed) {
            expect(opened.has(t.closed.seq)).toBe(true);
            expect(closed.has(t.closed.seq)).toBe(false);
            closed.add(t.closed.seq);
          }
          if (t.opened) {
            expect(t.opened.seq).toBeGreaterThan(s.seq);
            opened.add(t.opened.seq);
          }
          // Exactly the surfaces opened and not yet closed are open: at most one.
          const live = [...opened].filter((q) => !closed.has(q));
          expect(live.length).toBeLessThanOrEqual(1);
          expect(t.state.open?.seq ?? null).toBe(live[0] ?? null);
          s = t.state;
        }
      }),
    );
  });
});
