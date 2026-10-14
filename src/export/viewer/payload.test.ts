import { describe, expect, it } from "vitest";
import { PAYLOAD_LIMITS, parsePayload } from "./payload";

// The exported file's payload, as the viewer reads it: a file may have been edited by hand, so it is bounded
// before parsing and checked like any other diagram coming in.

const diagram = {
  format: "diagrams/v1",
  title: "Orders",
  nodes: [{ id: "a", stencil: "kafka.topic", label: "A", x: 0, y: 0 }],
  edges: [],
};
const payload = (extra: object = {}) =>
  JSON.stringify({
    version: 1,
    diagram,
    icons: { kafka: "data:image/svg+xml,%3Csvg%2F%3E" },
    options: { theme: "dark", startSimulation: null, exportedOn: "2026-10-12" },
    ...extra,
  });

describe("parsePayload", () => {
  it("loads diagrams containing invalid colour objects without throwing", () => {
    const result = parsePayload(payload({ diagram: { ...diagram, color: { toString: null } } }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.diagram.color).toBeUndefined();
  });

  it.each(["#fff0", "#abcd", "#11223344", "#abcdef00"])(
    "keeps canvas colour alpha in exported payloads: %s",
    (color) => {
      const result = parsePayload(payload({ diagram: { ...diagram, color } }));
      expect(result.ok && result.diagram.color).toBe(color);
    },
  );
  it("reads a payload the export wrote", () => {
    const p = parsePayload(payload());
    expect(p.ok && p.diagram.title).toBe("Orders");
    expect(p.ok && p.options.theme).toBe("dark");
    expect(p.ok && Object.keys(p.icons)).toEqual(["kafka"]);
  });

  it("refuses an oversized payload before parsing it", () => {
    const huge = " ".repeat(PAYLOAD_LIMITS.totalChars + 1);
    const p = parsePayload(huge);
    expect(p.ok).toBe(false);
    expect(!p.ok && p.error).toMatch(/too large/);
  });

  it("refuses a diagram over the app's own file budget", () => {
    const big = { ...diagram, description: "x".repeat(PAYLOAD_LIMITS.diagramChars) };
    const p = parsePayload(payload({ diagram: big }));
    expect(!p.ok && p.error).toMatch(/too large/);
  });

  it("refuses what isn't a whole diagram, or a damaged or newer file", () => {
    expect(parsePayload(payload({ diagram: { title: "x", nodes: [] } })).ok).toBe(false);
    expect(parsePayload("{not json").ok).toBe(false);
    expect(parsePayload(payload({ version: 2 })).ok).toBe(false);
    expect(parsePayload("__LIVE_DIAGRAMS_PAYLOAD__").ok).toBe(false);
  });

  it("keeps only data: image icons of a sane size", () => {
    const p = parsePayload(
      payload({
        icons: {
          ok: "data:image/svg+xml,%3Csvg%2F%3E",
          remote: "https://example.com/x.svg",
          script: "javascript:alert(1)",
          huge: `data:image/svg+xml,${"a".repeat(PAYLOAD_LIMITS.iconChars)}`,
        },
      }),
    );
    expect(p.ok && Object.keys(p.icons)).toEqual(["ok"]);
  });
});
