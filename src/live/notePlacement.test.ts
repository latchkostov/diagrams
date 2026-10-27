import { describe, expect, it } from "vitest";
import { freeNoteOffset, placeNote, type Box } from "./notePlacement";

it("a free caption stays clear when only a strip without extra spacing fits", () => {
  const desired = { x: 360, y: 166, width: 560, height: 74 };
  const row = { x: 0, y: 70, width: 1280, height: 193 };
  const offset = freeNoteOffset(desired, { width: 1280, height: 340 }, [row]);
  expect(offset).not.toBeNull();
  const top = desired.y + offset!.dy;
  expect(top).toBeGreaterThanOrEqual(row.y + row.height);
  expect(top + desired.height).toBeLessThanOrEqual(340);
});

const card = { w: 300, h: 100 };
const pane = { width: 1200, height: 700 };
const box = (l: number, t: number, w = 200, h = 70): Box => ({ l, t, r: l + w, b: t + h });
const covers = (pos: { left: number; top: number }, n: Box) =>
  pos.left < n.r && pos.left + card.w > n.l && pos.top < n.b && pos.top + card.h > n.t;

describe("narration card placement", () => {
  it("goes below the focus when that's free", () => {
    const pos = placeNote(box(500, 100), card, pane, []);
    expect(pos).toMatchObject({ placement: "below", top: 100 + 70 + 48 });
    expect(pos!.left + pos!.arrow).toBeCloseTo(600, 0); // the pointer reaches the focus centre
  });

  it("slides along the focus to avoid covering a neighbour", () => {
    const neighbour = box(330, 230, 180, 70); // under the focus, to the left
    const pos = placeNote(box(500, 100), card, pane, [neighbour])!;
    expect(pos.placement).toBe("below");
    expect(covers(pos, neighbour)).toBe(false);
  });

  it("moves to another side when below and above are crowded", () => {
    const row = [box(300, 220, 600, 120), box(300, -40, 600, 110)];
    const pos = placeNote(box(500, 100), card, pane, row)!;
    expect(["right", "left"]).toContain(pos.placement);
    for (const n of row) expect(covers(pos, n)).toBe(false);
  });

  it("never covers the focused nodes when it can help it", () => {
    const focused = [box(500, 100)];
    const pos = placeNote(box(500, 100), card, pane, [], focused)!;
    expect(covers(pos, focused[0])).toBe(false);
  });

  it("steps out into free space rather than cover a dimmed node beside the focus", () => {
    // Every spot right beside the focus covers a neighbour; there's free space further down.
    const ring = [box(250, 190, 700, 110), box(250, -100, 700, 150), box(160, 60, 300, 120), box(740, 60, 300, 120)];
    const pos = placeNote(box(500, 100), card, pane, ring)!;
    expect(pos).not.toBeNull();
    for (const n of ring) expect(covers(pos, n)).toBe(false);
    expect(pos.placement).toBe("below");
    expect(pos.left + pos.arrow).toBeCloseTo(600, 0); // still points at the focus
  });

  it("keeps the nearest spot when nothing is free anywhere", () => {
    const wall = [box(0, 0, 1200, 700)];
    const pos = placeNote(box(500, 100), card, pane, wall)!;
    expect(pos).toMatchObject({ placement: "below", top: 100 + 70 + 48 });
  });

  it("keeps inside the pane, and gives up when the card can't fit", () => {
    const pos = placeNote(box(1000, 600), card, pane, [])!;
    expect(pos.left + card.w).toBeLessThanOrEqual(pane.width - 16);
    expect(pos.top + card.h).toBeLessThanOrEqual(pane.height);
    expect(placeNote(box(10, 10), { w: 2000, h: 100 }, pane, [])).toBeNull();
  });
});
