import { expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { placeNew } from "../place";
import { layoutDiagram } from "./layout";

it.each([false, true])("preserves translated annotations from app layout (force %s)", (force) => {
  const input: DiagramFile = {
    format: "diagrams/v1",
    title: "Interleaved membership",
    nodes: ["b", "c", "a", "b", undefined, "b", undefined, "c"].map((group, i) => ({
      id: `n${i}`,
      stencil: "generic.service",
      label: "Service",
      group,
      x: 0,
      y: 0,
    })),
    edges: [
      { id: "a", from: "n0", to: "n4" },
      { id: "b", from: "n1", to: "n3" },
    ],
    groups: [
      { id: "a", label: "A", x: 0, y: 0, width: 1, height: 1 },
      { id: "b", label: "B", x: 0, y: 0, width: 1, height: 1 },
      { id: "c", label: "C", group: "a", x: 0, y: 0, width: 1, height: 1 },
    ],
    annotations: [{ id: "note", kind: "note", text: "Member note", group: "b", x: 0, y: 150, width: 120, height: 80 }],
  };
  const ids = input.nodes.map((n) => n.id);
  const app = placeNew(input, ids, "full", [], ids);
  const authored = { ...input.annotations![0], custom: { keep: "authored metadata" } };
  const raw = {
    ...input,
    nodes: force ? input.nodes : input.nodes.map(({ x: _x, y: _y, ...n }) => n),
    annotations: [authored, { id: "new", kind: "note", text: "New note" }],
  };
  const before = structuredClone(raw);
  const result = layoutDiagram(raw, { force });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const note = app.annotations![0];
  expect(note).not.toMatchObject({ x: authored.x, y: authored.y });
  expect(result.diagram.nodes).toEqual(app.nodes);
  expect(result.diagram.groups).toEqual(app.groups);
  expect(result.diagram.annotations).toEqual([
    { ...authored, x: note.x, y: note.y },
    expect.objectContaining({ id: "new", y: expect.any(Number) }),
  ]);
  const annotations = result.diagram.annotations as { y: number }[];
  expect(annotations[1].y).toBeGreaterThanOrEqual(note.y + note.height + 60);
  const boundary = app.groups!.find((g) => g.id === note.group)!;
  expect(note.x).toBeGreaterThanOrEqual(boundary.x);
  expect(note.y).toBeGreaterThanOrEqual(boundary.y);
  expect(note.x + note.width).toBeLessThanOrEqual(boundary.x + boundary.width);
  expect(note.y + note.height).toBeLessThanOrEqual(boundary.y + boundary.height);
  expect(raw).toEqual(before);
});
