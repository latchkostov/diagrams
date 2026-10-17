import { expect, it } from "vitest";
import { connectedMenuPlacement, type ConnectedMenuAnchor } from "./connectedMenuPlacement";

const anchor: ConnectedMenuAnchor = {
  spot: { x: 300, y: 200, width: 100, height: 60 },
  card: { x: 100, y: 200, width: 100, height: 60 },
  left: false,
  width: 288,
};

it("places the menu in physical screen coordinates at the current zoom and pane origin", () => {
  const bounds = { x: 40, y: 60, width: 1200, height: 800 };
  const view = { x: 400, y: 30, zoom: 0.5 };
  expect(connectedMenuPlacement(anchor, view, bounds)).toEqual({
    viewport: null,
    position: { x: 648, flipX: 582, y: 190 },
  });
  expect(connectedMenuPlacement({ ...anchor, left: true }, view, bounds).position).toEqual({
    x: 294,
    flipX: 582,
    y: 190,
  });
});

it.each([false, true])("reserves menu room after a pane resize (left=%s)", (left) => {
  const a = { ...anchor, left };
  const bounds = { x: 320, y: 60, width: 700, height: 500 };
  const view = { x: left ? -200 : 200, y: 0, zoom: 1 };
  const first = connectedMenuPlacement(a, view, bounds);
  expect(first.viewport).not.toBeNull();
  const settled = connectedMenuPlacement(a, first.viewport!, bounds);
  expect(settled.viewport).toBeNull();
  expect(settled.position.x).toBeGreaterThanOrEqual(bounds.x + 24);
  expect(settled.position.x + a.width).toBeLessThanOrEqual(bounds.x + bounds.width - 24);
});
