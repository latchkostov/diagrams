import { expect, it } from "vitest";
import { validateDiagram } from "../interop/native";
import { CLIP_FORMAT, parsePayload } from "../editor/clipboard";
import { toFlow } from "../canvas/convert";

it.each([undefined, null, "12", { toString: null }, [], NaN, Infinity, -1, 80, 0, 12.5, 40])(
  "normalizes untrusted native and clipboard radii: %j",
  (value) => {
    const input = {
      format: "diagrams/v1",
      title: "Radius",
      nodes: [],
      edges: [],
      groups: [{ id: "g", label: "Boundary", x: 0, y: 0, width: 300, height: 200, borderRadius: value }],
      annotations: [
        { id: "z", kind: "zone", text: "Zone", x: 400, y: 0, width: 300, height: 200, borderRadius: value },
      ],
    };
    const expected = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(40, value)) : undefined;
    const native = validateDiagram(input);
    expect(native.ok).toBe(true);
    if (!native.ok) return;
    expect(native.diagram.groups![0].borderRadius).toBe(expected);
    expect(native.diagram.annotations![0].borderRadius).toBe(expected);
    for (const n of toFlow(native.diagram).nodes) if (n.type !== "diagram") expect(n.data.borderRadius).toBe(expected);
    const clip = parsePayload(JSON.stringify({ ...input, format: CLIP_FORMAT }));
    expect(clip?.groups[0].borderRadius).toBe(expected);
    expect(clip?.annotations?.[0].borderRadius).toBe(expected);
  },
);
