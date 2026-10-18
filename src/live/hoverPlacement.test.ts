import { expect, it } from "vitest";
import { hoverRoom, hoverTop } from "./hoverPlacement";

it("compacts an expanded latency hover to the space beside the node, before it covers the card", () => {
  const pane = { top: 52, bottom: 900 },
    node = { top: 440, bottom: 510 };
  expect(hoverRoom(pane, node)).toBe(364);
  expect(hoverRoom(pane, node)).toBeLessThan(430);
  const compactHeight = 230;
  const top = hoverTop(pane, node, compactHeight);
  expect(top >= node.bottom + 34 || top + compactHeight <= node.top - 12).toBe(true);
  expect(top).toBeGreaterThanOrEqual(pane.top + 12);
  expect(top + compactHeight).toBeLessThanOrEqual(pane.bottom - 12);
});
