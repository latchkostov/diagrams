import { expect, it } from "vitest";
import { clearPanes, intersects, placeTip } from "./placement";

const pane = { x: 40, y: 130, width: 350, height: 500 };
it.each([false, true])("prefers logical inline-end for RTL=%s", (rtl) => {
  const target = { x: 450, y: 200, width: 40, height: 40 };
  const placed = placeTip(target, { width: 220, height: 80 }, [{ x: 0, y: 100, width: 1000, height: 600 }], rtl)!;
  expect(placed.side).toBe(rtl ? "left" : "right");
  expect(rtl ? placed.x + 220 < target.x : placed.x > target.x + target.width).toBe(true);
});
it("clamps a measured, wrapped tip above a phone dock without covering its target", () => {
  const target = { x: 260, y: 520, width: 100, height: 32 };
  const placed = placeTip(target, { width: 220, height: 150 }, [pane], false)!;
  expect(placed.x).toBeGreaterThanOrEqual(pane.x + 8);
  expect(placed.x + 220).toBeLessThanOrEqual(pane.x + pane.width - 8);
  expect(placed.y).toBeGreaterThanOrEqual(pane.y + 8);
  expect(placed.y + 150).toBeLessThanOrEqual(pane.y + pane.height - 8);
  expect(intersects({ ...placed, width: 220, height: 150 }, target)).toBe(false);
});
it("avoids rail, dock, transport and narration at visual viewport offsets", () => {
  const obstacles = [
    { x: 40, y: 500, width: 350, height: 130 },
    { x: 40, y: 130, width: 40, height: 370 },
    { x: 150, y: 430, width: 180, height: 60 },
    { x: 100, y: 130, width: 200, height: 90 },
  ];
  const panes = clearPanes(pane, obstacles);
  expect(panes.length).toBeGreaterThan(0);
  for (const p of panes) for (const obstacle of obstacles) expect(intersects(p, obstacle)).toBe(false);
  const size = { width: 160, height: 70 };
  const placed = placeTip({ x: 100, y: 260, width: 40, height: 30 }, size, panes, true)!;
  expect(placed).not.toBeNull();
  for (const obstacle of obstacles) expect(intersects({ ...placed, ...size }, obstacle)).toBe(false);
});
it("falls back to the strip when zoomed text has no unobstructed room", () => {
  expect(
    placeTip({ x: 60, y: 140, width: 300, height: 50 }, { width: 220, height: 160 }, [{ ...pane, height: 80 }], false),
  ).toBeNull();
});
