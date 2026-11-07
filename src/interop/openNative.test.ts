import { describe, expect, it } from "vitest";
import { parseNative } from "./native";
import { parseOpenedNative, wasLaidOutOnOpen } from "./openNative";
import { importText } from "./formats";
import { decodeShare } from "./share";
import { bytesToBase64Url, deflateRaw, textToBytes } from "./codec";
import { layoutDiagram } from "../ai/skill/layout";

const file = {
  format: "diagrams/v1",
  title: "Order delivery",
  nodes: [
    { id: "api", stencil: "service.node", label: "Orders", x: 23, y: 47 },
    { id: "worker", stencil: "service.java", label: "Worker", x: 403, y: 159 },
  ],
  edges: [
    {
      id: "flow",
      from: "api",
      to: "worker",
      kind: "async",
      fromSide: "bottom",
      toSide: "top",
      waypoints: [{ x: 230, y: 290 }],
    },
  ],
};
const unplaced = { ...file, nodes: file.nodes.map(({ x: _x, y: _y, ...node }) => node) };

describe("native files laid out on open", () => {
  it("uses the existing layout for absent and partial positions", async () => {
    for (const input of [
      unplaced,
      { ...file, nodes: [file.nodes[0], unplaced.nodes[1]] },
      { ...file, nodes: [{ ...unplaced.nodes[0], x: 23 }, file.nodes[1]] },
      { ...file, nodes: [{ ...unplaced.nodes[0], y: 47 }, file.nodes[1]] },
    ]) {
      const text = JSON.stringify(input);
      const expected = layoutDiagram(input);
      expect(expected.ok).toBe(true);
      const result = await parseOpenedNative(text);
      expect(result.ok).toBe(true);
      if (!result.ok || !expected.ok) throw new Error("Could not open diagram");
      const validated = parseNative(JSON.stringify(expected.diagram));
      if (!validated.ok) throw new Error(validated.error);
      expect(result.diagram).toEqual(validated.diagram);
      expect(new Set(result.diagram.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(2);
      expect(wasLaidOutOnOpen(result.diagram)).toBe(true);
      expect(result.warnings).toContain("The diagram was laid out on open.");
      expect(JSON.stringify(input)).toBe(text);
    }
  });

  it("rejects present invalid coordinates, even when another coordinate is absent", async () => {
    for (const bad of ["left", "23", null, true, {}, []]) {
      for (const axis of ["x", "y"]) {
        for (const node of [file.nodes[0], unplaced.nodes[0]]) {
          const text = JSON.stringify({ ...file, nodes: [{ ...node, [axis]: bad }, unplaced.nodes[1]] });
          const result = await parseOpenedNative(text);
          expect(result).toEqual(parseNative(text));
          expect(result).toMatchObject({ ok: false, error: expect.stringContaining("numeric x and y") });
        }
      }
    }
  });

  it("preserves repaired IDs and boundary membership on open", async () => {
    const input = {
      ...unplaced,
      nodes: unplaced.nodes.map((n) => ({ ...n, id: "shared", group: "shared" })),
      groups: [{ id: "shared", label: "Workers" }],
      edges: [],
    };
    const text = JSON.stringify(input);
    const result = await parseOpenedNative(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const { nodes, groups } = result.diagram;
    expect(nodes).toHaveLength(2);
    expect(groups).toHaveLength(1);
    const boundary = groups![0];
    expect(new Set([...nodes, boundary].map((n) => n.id)).size).toBe(3);
    expect(new Set(nodes.map((n) => `${n.x},${n.y}`)).size).toBe(2);
    expect(boundary.width).toBeGreaterThan(0);
    expect(boundary.height).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.group).toBe(boundary.id);
      expect(n.x).toBeGreaterThanOrEqual(boundary.x);
      expect(n.y).toBeGreaterThanOrEqual(boundary.y);
      expect(n.x).toBeLessThan(boundary.x + boundary.width);
      expect(n.y).toBeLessThan(boundary.y + boundary.height);
    }
    expect(JSON.stringify(input)).toBe(text);
  });

  it("leaves every positioned field, fixed side and waypoint on the existing validation path", async () => {
    const text = JSON.stringify(file);
    const result = await parseOpenedNative(text);
    expect(result).toEqual(parseNative(text));
    if (!result.ok) throw new Error("Could not open diagram");
    expect(wasLaidOutOnOpen(result.diagram)).toBe(false);
    expect(result.diagram.edges).toEqual(file.edges);
  });

  it("covers file/paste imports and share links, without accepting invalid documents", async () => {
    const imported = await importText(JSON.stringify(unplaced), "orders.diagram.json");
    expect(imported).toMatchObject({ ok: true, format: "native" });
    const payload = bytesToBase64Url(await deflateRaw(textToBytes(JSON.stringify(unplaced))));
    const shared = await decodeShare(payload);
    expect(shared.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(wasLaidOutOnOpen(shared)).toBe(true);
    for (const text of [
      "{",
      JSON.stringify({ ...unplaced, format: "unsupported" }),
      JSON.stringify({ ...unplaced, edges: [{ id: "bad", from: "missing", to: "worker" }] }),
    ])
      expect(await parseOpenedNative(text)).toMatchObject({ ok: false });
  });
});
