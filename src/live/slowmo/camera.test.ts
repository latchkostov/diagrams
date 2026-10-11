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

describe("slow motion camera keeps the hop at work out from under the trace card", () => {
  const covered = (b: FlowBox, v: { x: number; y: number; zoom: number }) => {
    const x = b.x * v.zoom + v.x;
    const y = b.y * v.zoom + v.y;
    return (
      x < card.x + card.width &&
      card.x < x + b.width * v.zoom &&
      y < card.y + card.height &&
      card.y < y + b.height * v.zoom
    );
  };

  it("follows, rather than fitting, when no fit keeps the path clear of the card", () => {
    const small = { width: 900, height: 700 };
    const everywhere = { x: 0, y: 0, width: 900, height: 700 };
    const path = [node(0, 0), node(300, 0)];
    const plan = planCamera(path, [path[0]], small, insets, [everywhere])!;
    expect(plan.mode).toBe("follow");
  });

  it("when a fan-out is too wide to keep beside the card, keeps the next target clear", () => {
    const view = frame(node(0, 0), pane, insets, FOLLOW_ZOOM);
    const near = [node(0, 0), node(0, 700)];
    const target = node(1500, 0);
    // Too wide to sit beside the card and too tall to sit below it: without a focus the frontier is
    // centred, and the target lands under the card.
    const blind = followPan([...near, target], view, pane, insets, [card])!;
    expect(covered(target, blind)).toBe(true);
    const pan = followPan([...near, target], view, pane, insets, [card], undefined, [target])!;
    expect(pan.zoom).toBe(FOLLOW_ZOOM);
    expect(covered(target, pan)).toBe(false);
    const x = target.x * pan.zoom + pan.x;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + target.width * pan.zoom).toBeLessThanOrEqual(pane.width);
  });
});
