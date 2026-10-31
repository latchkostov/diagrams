import { expect, it } from "vitest";
import { clearPanes, intersects, type Box } from "./placement";
import { keepCard, placeCard, placeHome, placeSheet } from "./coachPlacement";

const area = { x: 0, y: 50, width: 1440, height: 850 };
const size = { width: 340, height: 200 };
const target = { x: 700, y: 420, width: 40, height: 40 };
it("holds help still as a hover target disappears, but moves off new menus and targets", () => {
  const card = { x: 800, y: 400, ...size };
  expect(keepCard(card, null, area, [])).toMatchObject({ x: 800, y: 400 });
  expect(keepCard(card, target, area, [])?.leader).not.toBeNull();
  expect(keepCard(card, { ...target, x: 50 }, area, [])).toBeNull();
  expect(keepCard(card, card, area, [])).toBeNull();
  expect(keepCard(card, null, area, [card])).toBeNull();
  expect(keepCard({ ...card, y: 850 }, null, area, [])).toBeNull();
});
it.each([false, true])("prefers the logical side when room is equal (RTL=%s)", (rtl) => {
  const placed = placeCard(target, size, [area], area, rtl)!;
  expect(placed.side).toBe(rtl ? "left" : "right");
  expect(placed.nub).not.toBeNull();
  expect(placed.leader).toBeNull();
  expect(intersects({ ...placed, ...size }, target)).toBe(false);
});
it.each([
  [{ x: 70, y: 350, width: 40, height: 40 }, "right"],
  [{ x: 1320, y: 350, width: 40, height: 40 }, "left"],
  [{ x: 190, y: 70, width: 40, height: 40 }, "below"],
  [{ x: 190, y: 800, width: 40, height: 40 }, "above"],
] as const)("chooses a clear side by available room for %j", (t, side) => {
  const a = side === "above" || side === "below" ? { ...area, width: 440 } : area;
  const placed = placeCard(t, size, [a], a, false)!;
  expect(placed.side).toBe(side);
  expect(intersects({ ...placed, ...size }, t)).toBe(false);
});
it("clamps to clear panes, avoids menus and dock, and adds a short leader when displaced", () => {
  const obstacles = [
    { x: 1120, y: 50, width: 320, height: 850 },
    { x: 0, y: 50, width: 60, height: 850 },
    { x: 720, y: 400, width: 400, height: 500 },
    { x: 500, y: 800, width: 500, height: 100 },
  ];
  const t = { x: 1040, y: 850, width: 60, height: 35 };
  const placed = placeCard(t, size, clearPanes(area, obstacles), area, false)!;
  expect(placed.leader).not.toBeNull();
  expect(placed.nub).toBeNull();
  for (const o of [...obstacles, t]) expect(intersects({ ...placed, ...size }, o)).toBe(false);
  expect(placed.y).toBeGreaterThanOrEqual(area.y);
  expect(placed.y + size.height).toBeLessThanOrEqual(area.y + area.height);
});
it("homes under the visible diagram, or above it, without crossing chrome", () => {
  const anchor = { x: 500, y: 300, width: 200, height: 100 };
  const home = placeHome(anchor, size, [area], area);
  expect(home.x + size.width / 2).toBe(anchor.x + anchor.width / 2);
  expect(home.y).toBeGreaterThan(anchor.y + anchor.height);
  expect(placeHome({ ...anchor, y: 700 }, size, [area], area).y).toBeLessThan(700);
  expect(placeCard(target, size, [], area, false)).toBeNull();
});
const phone = { x: 0, y: 50, width: 390, height: 794 };
function sheetBox(s: ReturnType<typeof placeSheet>, height: number): Box {
  return { x: 8, y: s.y, width: 374, height };
}
it("flips the phone sheet and shrinks to title and actions instead of covering the target", () => {
  const t = { x: 40, y: 600, width: 200, height: 80 };
  expect(placeSheet(t, 240, phone, [], 80).edge).toBe("top");
  const tall = { x: 50, y: 250, width: 250, height: 400 };
  const s = placeSheet(tall, 240, phone, [], 80);
  expect(Number.isFinite(s.y)).toBe(true);
  expect(s.compact).toBe(true);
  expect(intersects(sheetBox(s, 80), tall)).toBe(false);
});
it("keeps the phone sheet above transport and dock and clear of an open menu", () => {
  const obstacles = [
    { x: 0, y: 700, width: 390, height: 144 },
    { x: 0, y: 50, width: 390, height: 100 },
  ];
  const t = { x: 70, y: 170, width: 120, height: 70 };
  const s = placeSheet(t, 200, phone, obstacles, 80);
  expect(s.y).toBeGreaterThanOrEqual(phone.y + 8);
  expect(s.y + 200).toBeLessThanOrEqual(700);
  for (const o of [...obstacles, t]) expect(intersects(sheetBox(s, 200), o)).toBe(false);
});

it("homes clear of a study's visible nodes and edge labels when the diagram fills the pane", () => {
  const lowerNode = { x: 540, y: 620, width: 300, height: 260 };
  const label = { x: 450, y: 700, width: 80, height: 30 };
  const place = placeHome({ x: 80, y: 100, width: 1200, height: 770 }, size, [area], area, [lowerNode, label]);
  expect(intersects({ ...place, ...size }, lowerNode)).toBe(false);
  expect(intersects({ ...place, ...size }, label)).toBe(false);
});
