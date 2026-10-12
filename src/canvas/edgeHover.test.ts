import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { edgeHover, nearestEdge } from "./edgeHover";

const lines = [
  {
    id: "row",
    points: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ],
  },
  {
    id: "elbow",
    points: [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 300 },
    ],
  },
];

describe("nearestEdge", () => {
  it("names the edge whose line passes within the tolerance, the nearest when two do", () => {
    expect(nearestEdge(lines, { x: 150, y: 6 }, 10)).toBe("row");
    expect(nearestEdge(lines, { x: 205, y: 250 }, 10)).toBe("elbow");
    expect(nearestEdge(lines, { x: 100, y: 52 }, 60)).toBe("elbow");
  });

  it("is null away from every line, and past a line's end", () => {
    expect(nearestEdge(lines, { x: 150, y: 50 }, 10)).toBeNull();
    expect(nearestEdge(lines, { x: 420, y: 0 }, 10)).toBeNull();
  });
});

describe("edgeHover", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const el = { setAttribute: vi.fn(), removeAttribute: vi.fn() } as unknown as Element;
    let under: string | null = null;
    const hover = edgeHover(
      () => under,
      () => el,
      300,
    );
    return { el, hover, over: (id: string | null) => (under = id) };
  };

  it("lights an edge up only after the pointer has stayed on it", () => {
    const { el, hover, over } = setup();
    over("row");
    hover.at(0, 0);
    vi.advanceTimersByTime(250);
    expect(hover.lit()).toBeNull();
    hover.at(1, 0);
    vi.advanceTimersByTime(60);
    expect(hover.lit()).toBe("row");
    expect(el.setAttribute).toHaveBeenCalledWith("data-insert", "1");
  });

  it("passing over an edge, or Ctrl/Cmd held, lights nothing; moving off clears it", () => {
    const { el, hover, over } = setup();
    over("row");
    hover.at(0, 0);
    vi.advanceTimersByTime(100);
    over(null);
    hover.at(0, 50);
    vi.advanceTimersByTime(500);
    expect(hover.lit()).toBeNull();
    over("row");
    hover.at(0, 0, true);
    vi.advanceTimersByTime(500);
    expect(hover.lit()).toBeNull();
    hover.at(0, 0);
    vi.advanceTimersByTime(300);
    expect(hover.lit()).toBe("row");
    over(null);
    hover.at(0, 80);
    expect(hover.lit()).toBeNull();
    expect(el.removeAttribute).toHaveBeenCalledWith("data-insert");
  });
});
