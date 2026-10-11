import { describe, expect, it } from "vitest";
import { diagramThumb, isThumb, THUMB_SIZE } from "./thumbnail";
import type { DiagramFile } from "../model/types";

// Public examples only (the glob doesn't descend into ./private).
const publicExamples = Object.values(
  import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" }),
);

describe("diagram thumbnails", () => {
  it("normalise nodes, boundaries and edges into a small viewBox", () => {
    const t = diagramThumb({
      nodes: [
        { id: "a", stencil: "kafka.topic", label: "A", x: 100, y: 100 },
        { id: "b", stencil: "generic.unknown-stencil", label: "B", x: 900, y: 300 },
      ],
      edges: [
        { id: "e", from: "a", to: "b" },
        { id: "dangling", from: "a", to: "ghost" },
      ],
      groups: [{ id: "g", label: "G", x: 60, y: 60, width: 500, height: 200 }],
    });
    expect(Math.max(t.w, t.h)).toBeCloseTo(THUMB_SIZE, 0);
    expect(t.nodes).toHaveLength(2);
    expect(t.groups).toHaveLength(1);
    expect(t.edges).toEqual([[0, 1]]);
    for (const [x, y, w, h] of t.nodes) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(t.w + 0.1);
      expect(y + h).toBeLessThanOrEqual(t.h + 0.1);
    }
    // Unknown stencils get the fallback accent rather than failing.
    expect(t.nodes[1][4]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("stay small enough for the library index, even for the largest example", () => {
    expect(publicExamples.length).toBeGreaterThan(0);
    for (const d of publicExamples) {
      const t = diagramThumb(d);
      expect(isThumb(t)).toBe(true);
      expect(JSON.stringify(t).length).toBeLessThan(3000);
    }
  });

  it("an empty diagram has an empty thumbnail", () => {
    expect(diagramThumb({ nodes: [], edges: [] }).nodes).toEqual([]);
  });

  it("reject tampered stored data", () => {
    const ok = diagramThumb({ nodes: [{ id: "a", stencil: "kafka.topic", label: "A", x: 0, y: 0 }], edges: [] });
    expect(isThumb(ok)).toBe(true);
    expect(isThumb({ ...ok, nodes: [[0, 0, 1, 1, "url(javascript:alert(1))"]] })).toBe(false);
    expect(isThumb({ ...ok, edges: [["a", 1]] })).toBe(false);
    expect(isThumb(null)).toBe(false);
  });
});
