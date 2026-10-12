import { describe, expect, it } from "vitest";
import { BREATHE_MS, GLOW_BOX, GlowRenderer, breath, easeInOut, glowAt, withOpacity } from "./toggleGlow";

describe("the breath's timing (lv-breathe)", () => {
  it("eases in and out like CSS ease-in-out", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 4);
    // Slow at both ends, symmetric.
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 4);
  });

  it("rests at 0% and 100%, peaks at 50%, every 1.8 s", () => {
    expect(breath(0)).toBeCloseTo(0);
    expect(breath(BREATHE_MS / 2)).toBeCloseTo(1);
    expect(breath(BREATHE_MS)).toBeCloseTo(0);
    expect(breath(BREATHE_MS * 5 + BREATHE_MS / 4)).toBeCloseTo(0.5, 4);
    expect(breath(BREATHE_MS / 4)).toBeCloseTo(breath((BREATHE_MS * 3) / 4), 6);
  });

  it("interpolates the two shadows between the resting style and the 50% keyframe", () => {
    expect(glowAt(0)).toEqual({ spread: 3, alpha: 0.25, blur: 10 });
    const peak = glowAt(1);
    expect(peak.spread).toBeCloseTo(6);
    expect(peak.alpha).toBeCloseTo(0.08);
    expect(peak.blur).toBeCloseTo(14);
    const mid = glowAt(0.5);
    expect(mid.spread).toBeCloseTo(4.5);
    expect(mid.alpha).toBeCloseTo(0.165);
    expect(mid.blur).toBeCloseTo(12);
  });
});

describe("withOpacity (color-mix with transparent)", () => {
  it("adds the alpha to computed colours of any syntax", () => {
    expect(withOpacity("rgb(31, 157, 97)", 0.25)).toBe("rgba(31,157,97,0.25)");
    expect(withOpacity("rgba(31, 157, 97, 1)", 0.08)).toBe("rgba(31,157,97,0.08)");
    expect(withOpacity("#1f9d61", 0.5)).toBe("rgba(31,157,97,0.5)");
    expect(withOpacity("oklab(0.6 -0.1 0.05)", 0.25)).toBe("oklab(0.6 -0.1 0.05 / 0.25)");
    expect(withOpacity("color(display-p3 0.1 0.6 0.4)", 0.25)).toBe("color(display-p3 0.1 0.6 0.4 / 0.25)");
  });
});

function fakeCanvas() {
  const calls: unknown[][] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
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
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, calls };
}

describe("GlowRenderer", () => {
  it("draws the glow, then the ring, and leaves the dot itself to CSS", () => {
    const { canvas, calls } = fakeCanvas();
    const g = new GlowRenderer(canvas);
    g.set("rgb(31, 157, 97)", 2);
    expect(canvas.width).toBe(GLOW_BOX * 2);
    g.draw(0, false);
    const sets = calls.filter((c) => typeof c[0] === "string" && (c[0] as string).startsWith("="));
    expect(sets).toContainEqual(["=shadowBlur", 20]); // 10 px blur at dpr 2
    expect(sets).toContainEqual(["=fillStyle", "rgba(31,157,97,0.25)"]);
    // The last thing drawn punches the dot out.
    const ops = sets.filter((c) => c[0] === "=globalCompositeOperation").map((c) => c[1]);
    expect(ops).toContain("destination-out");
    expect(ops.at(-1)).toBe("source-over");
  });

  it("skips repaints until the breath visibly moves, and rests while still", () => {
    const { canvas, calls } = fakeCanvas();
    const g = new GlowRenderer(canvas);
    g.set("rgb(31, 157, 97)", 1);
    const clears = () => calls.filter((c) => c[0] === "clearRect").length;
    g.draw(0, false);
    g.draw(1, false);
    expect(clears()).toBe(1);
    g.draw(400, false);
    expect(clears()).toBe(2);
    g.draw(900, true); // reduced motion: the resting style, drawn once
    g.draw(1200, true);
    expect(clears()).toBe(3);
  });

  it("draws nothing without a colour (the toggle is off)", () => {
    const { canvas, calls } = fakeCanvas();
    const g = new GlowRenderer(canvas);
    g.set("", 1);
    g.draw(300, false);
    expect(calls.filter((c) => c[0] === "fill")).toHaveLength(0);
  });
});
