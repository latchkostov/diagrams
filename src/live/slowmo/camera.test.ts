import { describe, expect, it } from "vitest";
import { FOLLOW_BELOW, FOLLOW_ZOOM, followPan, frame, planCamera, union, type FlowBox } from "./camera";

const pane = { width: 1440, height: 900 };
const insets = { top: 110, right: 48, bottom: 124, left: 48 };
const node = (x: number, y: number): FlowBox => ({ x, y, width: 220, height: 72 });
const card = { x: 1440 - 16 - 352, y: 64, width: 352, height: 220 };

describe("slow motion camera", () => {
  it("fits a path that reads at that zoom, and keeps it there", () => {
    const path = [node(0, 0), node(300, 0), node(600, 120)];
    const plan = planCamera(path, [path[0]], pane, insets, [card])!;
    expect(plan.mode).toBe("fit");
    expect(plan.zoom).toBeGreaterThanOrEqual(FOLLOW_BELOW);
    expect(plan.zoom).toBeLessThanOrEqual(1.25);
    // The path is on screen, clear of the card's first rows.
    const b = union(path)!;
    const left = b.x * plan.view.zoom + plan.view.x;
    const right = (b.x + b.width) * plan.view.zoom + plan.view.x;
    const top = b.y * plan.view.zoom + plan.view.y;
    expect(left).toBeGreaterThanOrEqual(insets.left - 1);
    expect(right <= card.x || top >= card.y + card.height).toBe(true);
  });

  it("follows at a readable zoom when the whole path would be too small", () => {
    const path = Array.from({ length: 12 }, (_, i) => node(i * 320, (i % 3) * 140));
    const plan = planCamera(path, [path[0]], pane, insets, [card])!;
    expect(plan.mode).toBe("follow");
    expect(plan.zoom).toBe(FOLLOW_ZOOM);
    expect(plan.view.zoom).toBe(FOLLOW_ZOOM);
    // It starts on the first node.
    const x = path[0].x * plan.view.zoom + plan.view.x;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(pane.width);
  });

  it("never follows under reduced motion: the whole path is fitted once", () => {
    const path = Array.from({ length: 12 }, (_, i) => node(i * 320, (i % 3) * 140));
    const plan = planCamera(path, [path[0]], pane, insets, [card], true)!;
    expect(plan.mode).toBe("fit");
    expect(plan.zoom).toBeLessThan(FOLLOW_BELOW);
    const b = union(path)!;
    expect(b.x * plan.zoom + plan.view.x).toBeGreaterThanOrEqual(insets.left - 1);
    expect((b.x + b.width) * plan.zoom + plan.view.x).toBeLessThanOrEqual(pane.width - insets.right + 1);
  });

  it("pans only when the frontier leaves the view, never zooming", () => {
    const view = frame(node(0, 0), pane, insets, FOLLOW_ZOOM);
    expect(followPan([node(0, 0)], view, pane, insets, [card])).toBeNull();
    const pan = followPan([node(2400, 0)], view, pane, insets, [card])!;
    expect(pan.zoom).toBe(FOLLOW_ZOOM);
    const x = 2400 * pan.zoom + pan.x;
    expect(x).toBeGreaterThan(0);
    expect(x + 220 * pan.zoom).toBeLessThan(pane.width);
    expect(followPan([], view, pane, insets)).toBeNull();
    expect(planCamera([], [], pane, insets)).toBeNull();
  });
});
