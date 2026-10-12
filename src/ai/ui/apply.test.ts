import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { diffDiagrams, failedRef, fileToDiagram, pickCandidate, planTurn, summarize } from "./apply";
import { parseReply } from "./reply";
import { buildFixPrompt, buildPrompt, describeError } from "./prompt";
import type { DiagramOp } from "../index";
import { overlaps } from "../../canvas/placement";
import { estimateCardSize } from "../../canvas/nodes/size";

const base = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Billing",
  nodes: [
    { id: "billing-worker", stencil: "service.dotnet", label: "billing-worker", x: 0, y: 0 },
    { id: "billing-db", stencil: "postgres", label: "billing-db", x: 300, y: 0 },
  ],
  edges: [{ id: "e1", from: "billing-worker", to: "billing-db", kind: "sync" }],
});

describe("planTurn", () => {
  it("applies ops and reports what changed in words", () => {
    const reply = parseReply(
      JSON.stringify([
        { op: "add_node", kind: "Kafka topic", label: "orders", key: "t" },
        { op: "connect", from: "t", to: "billing-worker" },
      ]),
    );
    const plan = planTurn(base(), reply);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.summary).toBe("+1 node, +1 connection");
    expect(plan.next.nodes).toHaveLength(3);
    const added = plan.next.nodes.find((n) => n.label === "orders")!;
    expect(added.stencil).toBe("kafka.topic");
    expect(plan.changed).toContain(added.id);
  });

  it("fails without applying and passes the core's candidates through", () => {
    const plan = planTurn(base(), parseReply('[{ "op": "remove", "targets": ["billing"] }]'));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error.candidates?.map((c) => c.id).sort()).toEqual(["billing-db", "billing-worker"]);
  });

  it("turns a parse failure into an error with a hint", () => {
    const plan = planTurn(base(), parseReply("no json here"));
    expect(plan).toMatchObject({ ok: false, error: { i: -1, error: "There's no JSON in the reply." } });
  });

  it("replaces the diagram with a file that has no coordinates, laid out", () => {
    const reply = parseReply(
      JSON.stringify({
        format: "diagrams/v1",
        title: "Orders",
        nodes: [
          { id: "api", stencil: "REST API", label: "orders-api" },
          { id: "topic", stencil: "kafka.topic", label: "orders" },
        ],
        edges: [{ from: "api", to: "topic" }],
      }),
    );
    const plan = planTurn(base(), reply);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.replaced).toBe(true);
    expect(plan.next.title).toBe("Orders");
    expect(plan.next.nodes.map((n) => n.id)).toEqual(["api", "topic"]);
    expect(plan.next.nodes[0].stencil).not.toBe("REST API");
    // Laid out: the two nodes don't sit on each other.
    expect(plan.next.nodes[0].x !== plan.next.nodes[1].x || plan.next.nodes[0].y !== plan.next.nodes[1].y).toBe(true);
    expect(plan.next.edges[0].id).toBe("e1");
  });
});

describe("diff and summary", () => {
  it("ignores moves and counts additions, removals and changes", () => {
    const a = base();
    const b: DiagramFile = {
      ...a,
      nodes: [{ ...a.nodes[0], x: 500, label: "billing" }],
      edges: [],
      groups: [{ id: "g1", label: "Azure", x: 0, y: 0, width: 10, height: 10 }],
    };
    const d = diffDiagrams(a, b);
    expect(summarize(d)).toBe("+1 boundary, −1 node, −1 connection, 1 changed");
    expect(d.changed.sort()).toEqual(["billing-worker", "g1"]);
    const moved: DiagramFile = { ...a, nodes: a.nodes.map((n) => ({ ...n, x: n.x + 40 })) };
    expect(summarize(diffDiagrams(a, moved))).toBe("no changes");
  });
});

describe("candidates", () => {
  it("reads the failed reference from the core's message", () => {
    expect(failedRef('"billing" matches 2 elements.')).toBe("billing");
    expect(failedRef('Unknown reference "pay\\"ments".')).toBe('pay"ments');
    expect(failedRef("Something else")).toBeUndefined();
  });

  it("patches the failing op, including one end of 'A -> B'", () => {
    const ops: DiagramOp[] = [
      { op: "add_node", kind: "queue", label: "dlq", key: "q" },
      { op: "remove", targets: ["billing -> billing-db", "billing"] },
    ];
    const fixed = pickCandidate(ops, 1, "billing", "billing-worker");
    expect(fixed?.[1]).toEqual({ op: "remove", targets: ["billing-worker -> billing-db", "billing-worker"] });
    expect(fixed?.[0]).toBe(ops[0]);
    expect(pickCandidate(ops, 0, "billing", "x")).toBeNull();
  });

  it("a picked candidate applies", () => {
    const ops: DiagramOp[] = [{ op: "update", target: "billing", label: "Billing worker" }];
    const failed = planTurn(base(), { ok: true, kind: "ops", ops });
    expect(failed.ok).toBe(false);
    const fixed = pickCandidate(ops, 0, "billing", "billing-worker")!;
    const plan = planTurn(base(), { ok: true, kind: "ops", ops: fixed });
    expect(plan.ok && plan.next.nodes[0].label).toBe("Billing worker");
  });
});

describe("prompts", () => {
  it("copies the format, two examples, the current diagram and the request", () => {
    const p = buildPrompt({ request: "Add a DLQ", describe: 'nodes:\n  billing-worker "billing-worker"' });
    expect(p).toContain('"oneOf"');
    expect(p).toContain("Example 1");
    expect(p).toContain("Example 2");
    expect(p).toContain('billing-worker "billing-worker"');
    expect(p.trim().endsWith("Add a DLQ")).toBe(true);
    expect(buildPrompt({ request: "x", describe: "" })).toContain("(empty: build it from scratch)");
  });

  it("puts the error, its candidates and the failed reply in the fix-up prompt", () => {
    const error = {
      i: 2,
      error: '"billing" matches 2 elements.',
      candidates: [{ id: "billing-db", label: "billing-db", stencil: "postgres" }],
      hint: "Use an id from candidates.",
    };
    expect(describeError(error)).toContain("Op 2 (0-based) failed");
    const p = buildFixPrompt({ request: "Remove billing", describe: "d", reply: "[bad]", error });
    expect(p).toContain('"billing" matches 2 elements.');
    expect(p).toContain('- id billing-db: "billing-db" (postgres)');
    expect(p).toContain("[bad]");
    expect(p).toContain("Remove billing");
  });
});

describe("fileToDiagram", () => {
  it("rejects files that aren't diagrams", () => {
    const twice = { id: "a", stencil: "kafka.topic", label: "a" };
    expect(fileToDiagram({ nodes: [twice, twice], edges: [] })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/share the id/),
    });
  });
});

describe("fileToDiagram positions", () => {
  const placed = (): DiagramFile => ({
    format: "diagrams/v1",
    title: "Placed",
    nodes: [
      { id: "api", stencil: "generic.service", label: "API", x: 640, y: 420, group: "cloud" },
      { id: "db", stencil: "postgres", label: "DB", x: 1100, y: 480, group: "cloud" },
      { id: "client", stencil: "generic.service", label: "Client", x: 40, y: 900 },
    ],
    edges: [
      { id: "e1", from: "client", to: "api" },
      { id: "e2", from: "api", to: "db", kind: "sync" },
    ],
    groups: [{ id: "cloud", label: "Cloud", x: 600, y: 380, width: 820, height: 260 }],
  });

  it("keeps every coordinate and boundary box of a file that has them", () => {
    const file = placed();
    const result = fileToDiagram(structuredClone(file) as unknown as Record<string, unknown>);
    if (!result.ok) throw new Error(result.error);
    expect(result.diagram.nodes).toEqual(file.nodes);
    expect(result.diagram.groups).toEqual(file.groups);
  });

  it("fits only the boundaries that have no box", () => {
    const file = placed() as unknown as { groups: Record<string, unknown>[] } & Record<string, unknown>;
    file.groups.push({ id: "empty-box", label: "Fitted" });
    (file.nodes as Record<string, unknown>[])[2].group = "empty-box";
    const result = fileToDiagram(file);
    if (!result.ok) throw new Error(result.error);
    expect(result.diagram.nodes.map((n) => [n.x, n.y])).toEqual([
      [640, 420],
      [1100, 480],
      [40, 900],
    ]);
    expect(result.diagram.groups?.[0]).toEqual(placed().groups![0]);
    const fitted = result.diagram.groups![1];
    expect(fitted.width).toBeGreaterThan(0);
    expect(fitted.x).toBeLessThan(40);
    expect(fitted.y).toBeLessThan(900);
  });

  it("places only the nodes without coordinates", () => {
    const file = placed() as unknown as Record<string, unknown>;
    const nodes = file.nodes as Record<string, unknown>[];
    nodes.push({ id: "cache", stencil: "redis", label: "Cache" });
    (file.edges as Record<string, unknown>[]).push({ id: "e3", from: "api", to: "cache" });
    const result = fileToDiagram(file);
    if (!result.ok) throw new Error(result.error);
    expect(result.diagram.nodes.slice(0, 3)).toEqual(placed().nodes);
    const cache = result.diagram.nodes[3];
    expect(Number.isFinite(cache.x) && Number.isFinite(cache.y)).toBe(true);
  });

  it("lays out a file without coordinates", () => {
    const file = placed() as unknown as Record<string, unknown>;
    for (const n of file.nodes as Record<string, unknown>[]) {
      delete n.x;
      delete n.y;
    }
    const result = fileToDiagram(file);
    if (!result.ok) throw new Error(result.error);
    const xs = result.diagram.nodes.map((n) => n.x);
    expect(new Set(xs).size).toBeGreaterThan(1);
  });
});

describe("fileToDiagram boundary membership", () => {
  const unplaced = () => ({
    format: "diagrams/v1",
    title: "Membership",
    nodes: [
      { id: "api", stencil: "generic.service", label: "API", group: "cloud" },
      { id: "db", stencil: "postgres", label: "DB", group: "cloud" },
      { id: "client", stencil: "generic.service", label: "Client" },
    ],
    edges: [
      { id: "e1", from: "client", to: "api" },
      { id: "e2", from: "api", to: "db" },
    ],
    groups: [{ id: "cloud", label: "Cloud" }],
  });

  it("keeps membership as written when it lays out a whole file", () => {
    const result = fileToDiagram(unplaced());
    if (!result.ok) throw new Error(result.error);
    expect(result.diagram.nodes.map((n) => [n.id, n.group])).toEqual([
      ["api", "cloud"],
      ["db", "cloud"],
      ["client", undefined],
    ]);
    const client = result.diagram.nodes[2];
    const cloud = result.diagram.groups![0];
    expect(overlaps({ ...client, ...estimateCardSize(client.label) }, cloud)).toBe(false);
  });

  it("keeps membership as written when it places some of a file's nodes", () => {
    const file = unplaced();
    const at = [
      [100, 100],
      [500, 100],
    ];
    file.nodes.slice(0, 2).forEach((n, i) => Object.assign(n, { x: at[i][0], y: at[i][1] }));
    const result = fileToDiagram(file);
    if (!result.ok) throw new Error(result.error);
    expect(result.diagram.nodes[2].group).toBeUndefined();
  });
});
