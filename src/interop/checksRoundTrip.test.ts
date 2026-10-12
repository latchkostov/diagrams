import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { CHECK_LIMITS, sanitizeChecks } from "../model/checks";
import { perfBudget } from "../test/perfBudget";
import { toFlow, fromFlow } from "../canvas/convert";
import { importText } from "./formats";
import { diagramToDrawio } from "./drawio/write";
import { diagramToMermaid } from "./mermaid/write";
import { serializeNative, validateDiagram } from "./native";

// The file's `checks` (rules turned off, findings ignored) travel with the diagram: through the editor,
// native JSON, draw.io and Mermaid (in its metadata comment). Validation bounds them and drops ignores
// whose element is gone.

const checks = {
  off: ["capacity"],
  ignore: [
    { rule: "dead-letter", target: "queue", reason: "Projection rebuilds from the log" },
    { rule: "sync-cycle", target: "e1" },
  ],
};
const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Checked",
  nodes: [
    { id: "api", stencil: "service.node", label: "API", x: 0, y: 0 },
    { id: "queue", stencil: "aws.sqs", label: "orders", x: 320, y: 0 },
  ],
  edges: [{ id: "e1", from: "api", to: "queue", kind: "async" }],
  checks,
};

async function reimport(text: string, name: string): Promise<DiagramFile> {
  const outcome = await importText(text, name);
  if (outcome.ok !== true) throw new Error(outcome.ok === false ? outcome.error : "pages");
  return outcome.diagram;
}

describe("checks round-trip", () => {
  it.each([
    ["native JSON", serializeNative, "x.diagram.json"],
    ["draw.io", (d: DiagramFile) => diagramToDrawio(d), "x.drawio"],
    ["Mermaid", (d: DiagramFile) => diagramToMermaid(d), "x.mmd"],
  ] as const)("%s keeps them", async (_name, write, file) => {
    expect((await reimport(write(diagram), file)).checks).toEqual(checks);
    const { checks: _none, ...plain } = diagram;
    expect(await reimport(write(plain), file)).not.toHaveProperty("checks");
  });

  it("Mermaid without metadata can't carry them", async () => {
    expect(await reimport(diagramToMermaid(diagram, { metadata: false }), "x.mmd")).not.toHaveProperty("checks");
  });

  it("the editor's state keeps them, and a save drops an ignore whose element is gone", () => {
    const flow = toFlow(diagram);
    expect(fromFlow(flow.meta, flow.nodes, flow.edges).checks).toEqual(checks);
    const withoutQueue = fromFlow(
      flow.meta,
      flow.nodes.filter((n) => n.id !== "queue"),
      flow.edges,
    );
    expect(withoutQueue.checks).toEqual({ off: ["capacity"], ignore: [{ rule: "sync-cycle", target: "e1" }] });
    // The meta keeps every ignore, so Undo (which restores the node) brings it back.
    expect(flow.meta.checks).toEqual(checks);
    const bare = toFlow({ ...diagram, checks: { ignore: [checks.ignore[0]] } });
    expect(fromFlow(bare.meta, [], [])).not.toHaveProperty("checks");
  });
});

describe("checks validation", () => {
  const validate = (value: unknown) => validateDiagram({ ...diagram, checks: value });

  it("keeps valid settings as they are, with no warnings", () => {
    expect(validate(checks)).toMatchObject({ ok: true, diagram: { checks }, warnings: [] });
  });

  it("drops an ignore whose element is gone, silently, and an empty field", () => {
    const r = validate({ ignore: [{ rule: "dead-letter", target: "removed" }] });
    expect(r).toMatchObject({ ok: true, warnings: [] });
    expect(r.ok && r.diagram).not.toHaveProperty("checks");
    expect(validate({})).toMatchObject({ ok: true, warnings: [] });
  });

  it("skips malformed entries with one warning, keeps unknown rule ids, shortens reasons", () => {
    const r = validate({
      off: ["future-rule", "Not An Id", 3, "future-rule"],
      ignore: [
        { rule: "dead-letter", target: "queue", reason: `  ${"x".repeat(300)}  ` },
        { rule: "dead-letter", target: "queue", reason: "duplicate" },
        { rule: "dead-letter" },
        "nope",
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.checks).toEqual({
      off: ["future-rule"],
      ignore: [{ rule: "dead-letter", target: "queue", reason: "x".repeat(CHECK_LIMITS.maxReason) }],
    });
    expect(r.warnings).toEqual(["4 malformed check settings were ignored."]);
    expect(validate("off")).toMatchObject({
      ok: true,
      warnings: ["The checks field wasn't an object and was ignored."],
    });
  });

  it("is bounded", () => {
    const off = Array.from({ length: CHECK_LIMITS.maxOff + 5 }, (_, i) => `rule-${i}`);
    const r = validate({ off });
    expect(r.ok && r.diagram.checks?.off).toHaveLength(CHECK_LIMITS.maxOff);
    expect(r.ok && r.warnings[0]).toMatch(/Only the first 100 turned-off checks/);
  });

  it("reads only the first entries, so a hostile list costs no more than a full one", () => {
    const many = 80_000;
    const ids = new Set(["queue"]);
    const hostile = {
      off: Array.from({ length: many }, (_, i) => `rule-${i}`),
      ignore: Array.from({ length: many }, (_, i) => ({ rule: `rule-${i % 7}`, target: "queue", reason: "x" })),
    };
    const repeated = { off: Array(many).fill("capacity"), ignore: Array(many).fill(checks.ignore[0]) };
    const longReason = { ignore: [{ rule: "dead-letter", target: "queue", reason: " ".repeat(1_000_000) + "why" }] };
    for (const input of [hostile, repeated, longReason]) {
      const warnings: string[] = [];
      const start = performance.now();
      const out = sanitizeChecks(input, ids, warnings);
      expect(performance.now() - start).toBeLessThan(perfBudget(50));
      expect(out?.off?.length ?? 0).toBeLessThanOrEqual(CHECK_LIMITS.maxOff);
      expect(out?.ignore?.length ?? 0).toBeLessThanOrEqual(CHECK_LIMITS.maxIgnores);
    }
    const warnings: string[] = [];
    expect(sanitizeChecks(hostile, ids, warnings)).toEqual({
      off: hostile.off.slice(0, CHECK_LIMITS.maxOff),
      ignore: Array.from({ length: 7 }, (_, i) => ({ rule: `rule-${i}`, target: "queue", reason: "x" })),
    });
    expect(warnings).toEqual(["Only the first 100 turned-off checks and 2000 ignored findings were read."]);
    expect(sanitizeChecks(repeated, ids, [])).toEqual({ off: ["capacity"], ignore: [checks.ignore[0]] });
    // A reason of spaces doesn't survive as one.
    expect(sanitizeChecks(longReason, ids, [])).toEqual({ ignore: [{ rule: "dead-letter", target: "queue" }] });
  });
});
