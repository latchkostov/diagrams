import { describe, expect, it } from "vitest";
import { MARCH_PERIOD_MS, MARCH_SHIFT, MarchRenderer, marchOffset, parseDash, type MarchEdge } from "./marchRenderer";

describe("the march's timing and dashes", () => {
  it("shifts the dashes like lv-march: -10 user units every 0.9 s, repeating", () => {
    expect(marchOffset(0, false)).toBeCloseTo(0);
    expect(marchOffset(MARCH_PERIOD_MS / 2, false)).toBeCloseTo(-MARCH_SHIFT / 2);
    expect(marchOffset(MARCH_PERIOD_MS * 3 + 90, false)).toBeCloseTo(-1);
  });

  it("stands at 0 under reduced motion, like animation: none", () => {
    expect(marchOffset(450, true)).toBeCloseTo(0);
  });

  it("parses computed dash arrays", () => {
    expect(parseDash("5px, 5px")).toEqual([5, 5]);
    expect(parseDash("0.5px 4px")).toEqual([0.5, 4]);
    expect(parseDash("none")).toEqual([]);
    expect(parseDash("")).toEqual([]);
    expect(parseDash("0px, 0px")).toEqual([]);
  });
});

type Call = [string, ...unknown[]];

function fakeCanvas() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: unknown[]) => calls.push([key, ...args]);
    },
    set(t, key: string, value) {
      t[key] = value;
      calls.push([`=${key}`, value]);
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const edge = (over: Partial<MarchEdge> = {}): MarchEdge => ({
  id: "a-to-b",
  d: "M0 0 L100 0",
  color: "oklab(0.5 0 -0.08)",
  width: 2,
  dash: [5, 5],
  opacity: 1,
  ...over,
});

const view = { x: 10, y: 20, zoom: 2, width: 300, height: 200, dpr: 1.5 };

describe("MarchRenderer", () => {
  it("strokes each marching edge's own path with its colour, width, dash and offset, in flow units", () => {
    const { canvas, calls } = fakeCanvas();
    const paths: string[] = [];
    const r = new MarchRenderer(canvas, (d) => (paths.push(d), { d } as unknown as Path2D));
    r.setEdges([edge(), edge({ id: "c-to-d", d: "M0 10 L50 10", opacity: 0.15 })]);
    r.draw(view, 450, false);
    expect(canvas.width).toBe(450);
    expect(canvas.height).toBe(300);
    // Flow → device: k = zoom × dpr, offset by the viewport in device px.
    expect(calls).toContainEqual(["setTransform", 3, 0, 0, 3, 15, 30]);
    expect(calls).toContainEqual(["setLineDash", [5, 5]]);
    expect(calls).toContainEqual(["=lineDashOffset", -5]);
    expect(calls).toContainEqual(["=strokeStyle", "oklab(0.5 0 -0.08)"]);
    expect(calls).toContainEqual(["=lineWidth", 2]);
    expect(calls).toContainEqual(["=globalAlpha", 0.15]);
    expect(calls.filter((c) => c[0] === "stroke")).toHaveLength(2);
    expect(paths).toEqual(["M0 0 L100 0", "M0 10 L50 10"]);
    expect(r.frames).toBe(1);
  });

  it("skips frames that wouldn't change, and redraws when the march, the view or the edges do", () => {
    const { canvas, calls } = fakeCanvas();
    const r = new MarchRenderer(canvas, () => ({}) as Path2D);
    r.setEdges([edge()]);
    r.draw(view, 100, false);
    const strokes = () => calls.filter((c) => c[0] === "stroke").length;
    expect(strokes()).toBe(1);
    r.draw(view, 100, false); // paused: the same phase
    expect(strokes()).toBe(1);
    r.draw(view, 116, false);
    expect(strokes()).toBe(2);
    r.draw({ ...view, x: 12 }, 116, false); // panned
    expect(strokes()).toBe(3);
    r.setEdges([edge({ color: "red" })]);
    r.draw({ ...view, x: 12 }, 116, false);
    expect(strokes()).toBe(4);
  });

  it("clears once when the last edge stops marching, then does nothing", () => {
    const { canvas, calls } = fakeCanvas();
    const r = new MarchRenderer(canvas, () => ({}) as Path2D);
    r.setEdges([edge()]);
    r.draw(view, 0, false);
    r.setEdges([]);
    const clears = () => calls.filter((c) => c[0] === "clearRect").length;
    const before = clears();
    r.draw(view, 16, false);
    expect(clears()).toBe(before + 1);
    r.draw(view, 32, false);
    r.draw(view, 48, false);
    expect(clears()).toBe(before + 1);
  });

  it("caches a Path2D per path and forgets paths no longer marching", () => {
    const { canvas } = fakeCanvas();
    let made = 0;
    const r = new MarchRenderer(canvas, () => (made++, {}) as Path2D);
    r.setEdges([edge()]);
    r.draw(view, 0, false);
    r.draw(view, 16, false);
    expect(made).toBe(1);
    r.setEdges([edge({ d: "M0 0 L120 0" })]);
    r.draw(view, 32, false);
    r.setEdges([edge()]);
    r.draw(view, 48, false);
    expect(made).toBe(3);
  });
});
