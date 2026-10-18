import { describe, expect, it } from "vitest";
import { paneSample } from "./useCameraCore";

type Node = {
  id: string;
  type?: string;
  hidden?: boolean;
  width?: number;
  height?: number;
  measured: { width?: number; height?: number };
  internals: { positionAbsolute: { x: number; y: number } };
};
const node = (id: string, x: number, measured: Node["measured"], extra: Partial<Node> = {}): Node => ({
  id,
  measured,
  internals: { positionAbsolute: { x, y: 0 } },
  ...extra,
});
const sample = (nodes: Node[]) =>
  paneSample(
    { width: 1000, height: 800, nodeLookup: new Map(nodes.map((n) => [n.id, n])) as never },
    { clientWidth: 1000, clientHeight: 800 },
    () => true,
  );

describe("paneSample: pane work runs on complete geometry only", () => {
  it("waits through stable incomplete measurements: a node Live added, not selected, not yet measured", () => {
    const placed = node("a", 0, { width: 200, height: 72 });
    // The same incomplete geometry for any number of frames never agrees on a sample: nothing settles.
    for (let frame = 0; frame < 5; frame++) expect(sample([placed, node("new", 400, {})])).toBeNull();
    expect(sample([placed, node("new", 400, { width: 220, height: 72 })])).not.toBeNull();
  });

  it("changes when a measured node's size or position changes, not only the count", () => {
    const before = sample([node("a", 0, { width: 200, height: 72 })]);
    expect(sample([node("a", 0, { width: 240, height: 72 })])).not.toBe(before);
    expect(sample([node("a", 30, { width: 200, height: 72 })])).not.toBe(before);
    expect(sample([node("a", 0, { width: 200, height: 72 })])).toBe(before);
  });

  it("skips hidden nodes and a boundary with an empty axis (React Flow never measures it)", () => {
    const placed = node("a", 0, { width: 200, height: 72 });
    expect(sample([placed, node("h", 9, {}, { hidden: true })])).not.toBeNull();
    expect(sample([placed, node("b", 9, {}, { type: "boundary", width: 0, height: 50 })])).not.toBeNull();
    expect(sample([placed, node("b", 9, {}, { type: "boundary", width: 300, height: 200 })])).toBeNull();
  });
});
