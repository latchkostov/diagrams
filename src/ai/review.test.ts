import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import { diagramDiff } from "../editor/diagramDiff";
import { LIMITS } from "../interop/native";
import { applyOps, buildSimulation, resolveKind } from "./index";
import * as refs from "./refs";
import { fileToDiagram, planTurn, swapStencil } from "./ui/apply";
import { parseReply } from "./ui/reply";
import { sharedDefs } from "./schemas";
import { checkSchema } from "./validation";
import { describeForAi } from "./privacy";
import type { EditorApi } from "../editor/types";
import { buildTools } from "./webmcp/tools";
import { toModelContextTool } from "./webmcp/adapter";
import { diagramV1Schema } from "./schemas";
import { checkJsonSchema } from "../model/jsonSchema";
import { validateDiagram } from "../interop/native";
import { overlaps } from "../canvas/placement";
import { estimateCardSize } from "../canvas/nodes/size";
import { placeNew } from "./place";

const base = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Synthetic",
  nodes: [
    { id: "a", label: "Alpha", stencil: "generic.service", x: 900, y: 400 },
    { id: "b", label: "Beta", stencil: "postgres", x: 0, y: 100 },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
});
const fence = (text: string) => `\`\`\`json\n${text}\n\`\`\``;
afterEach(() => vi.restoreAllMocks());

describe("AI review regressions", () => {
  it("refuses retained tool callbacks when provenance becomes local-only", async () => {
    let localOnly = false;
    const getDiagram = vi.fn(base);
    const applyDiagram = vi.fn();
    const editor = { getDiagram, applyDiagram } as unknown as EditorApi;
    const shareLink = vi.fn(async () => ({ url: "synthetic", length: 9 }));
    const tools = buildTools({
      getEditor: () => editor,
      canUseAi: () => !localOnly,
      onApplied: vi.fn(),
      newDiagram: async () => editor,
      shareLink,
    }).map(toModelContextTool);
    localOnly = true;
    for (const name of ["describe_diagram", "check_diagram", "edit_diagram", "set_simulation", "get_share_link"]) {
      const tool = tools.find((t) => t.name === name)!;
      const result = await tool.execute({ ops: [{ op: "remove", targets: ["a"] }] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Local-only");
    }
    expect(getDiagram).not.toHaveBeenCalled();
    expect(applyDiagram).not.toHaveBeenCalled();
    expect(shareLink).not.toHaveBeenCalled();
    expect(describeForAi(editor, { editor, localOnly: true })).toContain("Local-only");
    expect(getDiagram).not.toHaveBeenCalled();
  });
  it.each(['[{"label":"replacement"}]', '[{"op":"connect",', '{"ops":"wrong"}'])(
    "rejects the complete multi-block reply when block 2 is invalid: %s",
    (bad) => {
      const d = base();
      const reply = parseReply(`${fence('[{"op":"remove","targets":["a"]}]')}\n${fence(bad)}`);
      expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/Block 2/) });
      expect(planTurn(d, reply).ok).toBe(false);
      expect(d.nodes).toHaveLength(2);
    },
  );
  it("rejects an unclosed second fence and reports block-local schema failures", () => {
    const valid = fence('[{"op":"remove","targets":["a"]}]');
    expect(parseReply(`${valid}\n\`\`\`json\n[{"op":"connect",`)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Block 2/),
    });
    expect(parseReply(`${valid}\n${fence('[{"op":"connect","from":"a"}]')}`)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Block 2/),
    });
  });
  it("checks the character budget after filling missing native file fields", () => {
    const file = { nodes: [{ stencil: "generic.service" }], edges: [], description: "" };
    file.description = "x".repeat(LIMITS.maxTextChars - JSON.stringify(file).length);
    expect(JSON.stringify(file).length).toBe(LIMITS.maxTextChars);
    expect(fileToDiagram(file)).toMatchObject({ ok: false, error: expect.stringMatching(/limit/) });
  });
  it("rejects mixed whole-file and operation blocks instead of ignoring operations", () => {
    expect(parseReply(`${fence(JSON.stringify(base()))}\n${fence('[{"op":"set_meta","title":"x"}]')}`).ok).toBe(false);
  });
  it("bounds object and string tool-call wrappers without overflowing", () => {
    const deep = '{"input":'.repeat(10_000) + '[{"op":"set_meta"}]' + "}".repeat(10_000);
    expect(parseReply(deep)).toMatchObject({ ok: false, error: expect.stringMatching(/nesting/i) });
    let inner = deep;
    for (let i = 0; i < 3; i++) inner = JSON.stringify({ input: inner });
    expect(parseReply(inner).ok).toBe(false);
  });
  it("rejects oversized reply text before JSON parsing", () => {
    const text = JSON.stringify({ ...base(), description: "x".repeat(LIMITS.maxTextChars) });
    const spy = vi.spyOn(JSON, "parse");
    expect(parseReply(text)).toMatchObject({ ok: false, error: expect.stringMatching(/large|limit/i) });
    expect(spy).not.toHaveBeenCalled();
  });
  it("checks whole-file budgets even when called with a parsed object", () => {
    expect(fileToDiagram({ ...base(), description: "x".repeat(LIMITS.maxTextChars + 1) })).toMatchObject({ ok: false });
  });
  it.each(["diagrams/v2", "other/v1", null])("preserves and rejects explicit unsupported format %s", (format) => {
    expect(fileToDiagram({ ...base(), format })).toMatchObject({ ok: false });
    const { format: _format, ...bare } = base();
    expect(fileToDiagram(bare).ok).toBe(true);
  });
  it("accepts structural layout changes and separates moves from content updates", () => {
    const d = base();
    const plan = planTurn(d, parseReply('{"ops":[{"op":"set_meta"}],"layout":"full"}'));
    expect(plan).toMatchObject({ ok: true, hasChanges: true });
    if (!plan.ok) throw new Error("Expected a layout plan");
    expect(plan.next.nodes).not.toEqual(d.nodes);
    const diff = diagramDiff(d, plan.next);
    expect(diff.updated.count).toBe(0);
    expect(diff).toMatchObject({ hasChanges: true, moved: { count: 2 } });
    expect(plan.summary).toMatch(/layout|moved/i);
    expect(planTurn(d, parseReply('[{"op":"set_meta"}]'))).toMatchObject({ ok: true, hasChanges: false });
  });
  it("accepts a full layout with no edit operations", () => {
    const reply = parseReply('{"ops":[],"layout":"full"}');
    expect(reply).toMatchObject({ ok: true, kind: "ops", ops: [], layout: "full" });
    expect(planTurn(base(), reply)).toMatchObject({ ok: true, hasChanges: true, summary: "layout changed" });
    expect(applyOps(base(), [], { layout: "full" }).ok).toBe(true);
    expect(applyOps(base(), []).ok).toBe(false);
  });
  it("never resolves a missing stencil choice by a similar label", () => {
    const d = base();
    d.nodes[0].label = "lambda-1 processor";
    expect(swapStencil(d, "lambda-1", "azure.functions").ok).toBe(false);
  });
  it("does not force scheduled work to stop at 60 seconds", () => {
    const sim = buildSimulation(base(), {
      title: "Late work",
      traffic: [{ from: "a", pattern: "burst", count: 1, startSec: 90 }],
      events: [{ atSec: 80, node: "a", do: "up" }],
    });
    expect(sim).not.toHaveProperty("durationMs");
    expect(
      buildSimulation(base(), {
        title: "Bounded",
        durationSec: 100,
        traffic: [{ from: "a", pattern: "burst", count: 1 }],
      }).durationMs,
    ).toBe(100_000);
  });
  it("reuses the same reference index for every member in a batch", () => {
    const spy = vi.spyOn(refs, "resolveRef");
    expect(applyOps(base(), [{ op: "add_boundary", label: "Cloud", members: ["a", "b"] }]).ok).toBe(true);
    const calls: unknown[][] = spy.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][3]).toBeDefined();
    expect(calls[1][3]).toBe(calls[0][3]);
  });
  it("groups a large batch without repeated whole-diagram scans per member", () => {
    const d: DiagramFile = {
      format: "diagrams/v1",
      title: "Synthetic batch",
      nodes: Array.from({ length: 500 }, (_, i) => ({
        id: `n${i}`,
        label: `Node ${i}`,
        stencil: "generic.service",
        x: i * 240,
        y: 0,
      })),
      edges: Array.from({ length: 2000 }, (_, i) => ({ id: `e${i}`, from: `n${i % 500}`, to: `n${(i + 1) % 500}` })),
    };
    const members = d.nodes.map((n) => n.id);
    const originalMap = Array.prototype.map;
    let scans = 0;
    const spy = vi.spyOn(Array.prototype, "map").mockImplementation(function (
      this: unknown[],
      ...args: Parameters<typeof originalMap>
    ) {
      if (this.length === 500 || this.length === 2000) scans++;
      return originalMap.apply(this, args);
    });
    const result = applyOps(d, [{ op: "add_boundary", label: "Synthetic cloud", members }], { layout: "none" });
    spy.mockRestore();
    expect(result.ok).toBe(true);
    expect(result.diagram.nodes.every((n) => n.group === result.diagram.groups?.[0].id)).toBe(true);
    expect(scans).toBeLessThan(50);
  });
  it("keeps reference indexes current after create, rename, edge changes and remove", () => {
    const result = applyOps(
      base(),
      [
        { op: "add_node", kind: "service.dotnet", label: "Worker", key: "w" },
        { op: "update", target: "w", label: "Renamed" },
        { op: "connect", from: "Renamed", to: "Beta" },
        { op: "update", target: "Renamed -> Beta", label: "Writes" },
        { op: "remove", targets: ["Writes"] },
        { op: "add_boundary", label: "Cloud", members: ["Renamed", "Alpha"] },
      ],
      { layout: "none" },
    );
    expect(result.ok).toBe(true);
    expect(result.diagram.edges).toHaveLength(1);
    expect(result.diagram.nodes.find((n) => n.label === "Renamed")?.group).toBeDefined();
    const stale = applyOps(result.diagram, [{ op: "remove", targets: ["Writes"] }]);
    expect(stale.errors[0]).toMatchObject({ ref: "Writes" });
  });
  it("refuses changed snapshots and detects simulations and boundary geometry structurally", () => {
    const d = base();
    const expected = structuredClone(d.nodes[0]);
    d.nodes[0].label = "Changed in a later turn";
    expect(swapStencil(d, "a", "azure.functions", expected).ok).toBe(false);
    const after = { ...d, simulations: [{ id: "sim", title: "New simulation", traffic: [] }] };
    expect(diagramDiff(d, after)).toMatchObject({ hasChanges: true, added: { simulations: ["sim"] } });
    const grouped = { ...d, groups: [{ id: "g", label: "Cloud", x: 0, y: 0, width: 1, height: 1 }] };
    expect(diagramDiff(grouped, { ...grouped, groups: [{ ...grouped.groups[0], width: 20 }] })).toMatchObject({
      hasChanges: true,
      updated: { count: 0 },
      moved: { groups: ["g"] },
    });
    expect(diagramDiff(d, { edges: d.edges, nodes: d.nodes, title: d.title, format: d.format }).hasChanges).toBe(false);
  });
  it("reports the failed reference as data", () => {
    expect(applyOps(base(), [{ op: "remove", targets: ["missing"] }]).errors[0]).toMatchObject({ ref: "missing" });
  });
  it.each([".NET consumer", "Postgres writer", "gizmo"])("offers plausible alternatives for %s", (kind) => {
    const r = resolveKind(kind);
    expect(r.confidence).not.toBe("high");
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives).not.toContain(r.id);
    expect(new Set(r.alternatives).size).toBe(r.alternatives.length);
  });
  it("returns the human summary from the core", () => {
    expect(
      applyOps(base(), [
        { op: "add_node", kind: "service.dotnet", label: "Worker", key: "w" },
        { op: "connect", from: "a", to: "w" },
      ]).summary,
    ).toBe("+1 node, +1 connection");
  });
  it("accepts emits maps in AI add/update schemas, and rejects invalid map values", () => {
    const props = { emits: { Input: "Output" }, jitter: 0.2 };
    expect(() => checkSchema(props, sharedDefs.NodeProps)).not.toThrow();
    expect(applyOps(base(), [{ op: "update", target: "a", props }]).ok).toBe(true);
    expect(() => checkSchema({ emits: { Input: 42 } }, sharedDefs.NodeProps)).toThrow();
    expect(applyOps(base(), [{ op: "update", target: "a", props: { emits: null } }]).ok).toBe(true);
  });
  it("publishes the native simulation-property contract, including maps in setup and timeline", () => {
    const file = base();
    file.nodes[0].props = { emits: { Input: "Output" }, jitter: 0.2, retryBackoffMs: 500 };
    file.simulations = [
      {
        id: "sim",
        title: "Synthetic",
        traffic: [],
        setup: { props: { a: file.nodes[0].props } },
        timeline: [{ atMs: 0, action: { do: "props", node: "a", props: file.nodes[0].props } }],
      },
    ];
    expect(validateDiagram(file).ok).toBe(true);
    expect(() =>
      checkJsonSchema(file, diagramV1Schema, "file", diagramV1Schema.$defs as Record<string, Record<string, unknown>>),
    ).not.toThrow();
    file.nodes[0].props = { concurrency: 0, replicas: 1.5, latencyMs: undefined };
    expect(validateDiagram(file).ok).toBe(true);
    expect(() =>
      checkJsonSchema(file, diagramV1Schema, "file", diagramV1Schema.$defs as Record<string, Record<string, unknown>>),
    ).not.toThrow();
    file.nodes[0].props = { emits: { Input: "Output" } };
    file.simulations[0].timeline = [{ atMs: 0, action: { do: "props", node: "a", props: { emits: { Input: 42 } } } }];
    expect(() =>
      checkJsonSchema(file, diagramV1Schema, "file", diagramV1Schema.$defs as Record<string, Record<string, unknown>>),
    ).toThrow();
    file.nodes[0].props = { emits: { Input: 42 } };
    expect(validateDiagram(file).ok).toBe(false);
    expect(() =>
      checkJsonSchema(file, diagramV1Schema, "file", diagramV1Schema.$defs as Record<string, Record<string, unknown>>),
    ).toThrow();
  });
  it.each(["auto", "full", "none"] as const)("never places an ungrouped addition inside a boundary in %s", (mode) => {
    const d = base();
    d.nodes.push({ id: "new", label: "New", stencil: "generic.service", x: 0, y: 0 });
    d.nodes[0] = { ...d.nodes[0], x: 100, y: 100, group: "g" };
    d.groups = [{ id: "g", label: "Cloud", x: 0, y: 0, width: 900, height: 800 }];
    d.edges = [
      { id: "e", from: "a", to: "new" },
      { id: "e2", from: "b", to: "new" },
    ];
    const placed = placeNew(d, ["new"], mode);
    const n = placed.nodes.find((n) => n.id === "new")!;
    expect(n.group).toBeUndefined();
    expect(placed.groups?.every((g) => !overlaps({ ...n, ...estimateCardSize(n.label) }, g))).toBe(true);
  });
  it("joins the boundary of the only neighbour and respects explicit membership", () => {
    const d = base();
    d.nodes[0].group = "g";
    d.groups = [{ id: "g", label: "Cloud", x: 0, y: 0, width: 1200, height: 800 }];
    const result = applyOps(d, [
      { op: "add_node", kind: "queue", label: "New", key: "n" },
      { op: "connect", from: "a", to: "n" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.diagram.nodes.find((n) => n.label === "New")?.group).toBe("g");
    const explicit = applyOps(d, [
      { op: "add_node", kind: "queue", label: "New", key: "n", in: "g" },
      { op: "connect", from: "a", to: "n" },
      { op: "connect", from: "b", to: "n" },
    ]);
    expect(explicit.diagram.nodes.find((n) => n.label === "New")?.group).toBe("g");
  });
});
