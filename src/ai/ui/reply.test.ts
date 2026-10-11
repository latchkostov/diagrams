import { describe, expect, it } from "vitest";
import { parseReply } from "./reply";

const OPS = [
  { op: "add_node", kind: "Kafka topic", label: "orders", key: "t" },
  { op: "add_node", kind: ".NET consumer", label: "billing-worker", key: "w" },
  { op: "connect", from: "t", to: "w" },
];

describe("parseReply", () => {
  it("reads a fenced ```json block inside prose", () => {
    const text = `Sure! Here are the ops:\n\n\`\`\`json\n${JSON.stringify(OPS, null, 2)}\n\`\`\`\n\nLet me know if you want changes.`;
    expect(parseReply(text)).toEqual({ ok: true, kind: "ops", ops: OPS });
  });

  it("reads a fence without a language, and ~~~ fences", () => {
    expect(parseReply("```\n" + JSON.stringify(OPS) + "\n```")).toMatchObject({ ok: true, kind: "ops" });
    expect(parseReply("~~~json\n" + JSON.stringify(OPS) + "\n~~~")).toMatchObject({ ok: true, kind: "ops" });
  });

  it("reads plain JSON with no fence", () => {
    expect(parseReply(JSON.stringify(OPS))).toEqual({ ok: true, kind: "ops", ops: OPS });
  });

  it("reads a bare array of ops embedded in prose", () => {
    const r = parseReply(`Here you go: ${JSON.stringify(OPS)} (3 ops)`);
    expect(r).toEqual({ ok: true, kind: "ops", ops: OPS });
  });

  it("reads { ops, layout } and a single op", () => {
    expect(parseReply(JSON.stringify({ ops: OPS, layout: "full" }))).toEqual({
      ok: true,
      kind: "ops",
      ops: OPS,
      layout: "full",
    });
    expect(parseReply(JSON.stringify(OPS[0]))).toEqual({ ok: true, kind: "ops", ops: [OPS[0]] });
  });

  it("reads an edit_diagram tool call wrapper", () => {
    const r = parseReply(JSON.stringify({ name: "edit_diagram", arguments: { ops: OPS } }));
    expect(r).toEqual({ ok: true, kind: "ops", ops: OPS });
  });

  it("joins ops split across several fenced blocks", () => {
    const text = `First:\n\`\`\`json\n${JSON.stringify(OPS.slice(0, 2))}\n\`\`\`\nThen:\n\`\`\`json\n${JSON.stringify(OPS.slice(2))}\n\`\`\``;
    expect(parseReply(text)).toEqual({ ok: true, kind: "ops", ops: OPS });
  });

  it("forgives trailing commas", () => {
    const text = '[{ "op": "add_node", "kind": "Postgres", "label": "db", },]';
    expect(parseReply(text)).toEqual({
      ok: true,
      kind: "ops",
      ops: [{ op: "add_node", kind: "Postgres", label: "db" }],
    });
  });

  it("reads a full diagrams/v1 file, with or without coordinates", () => {
    const file = {
      format: "diagrams/v1",
      title: "Orders",
      nodes: [{ id: "a", stencil: "kafka.topic", label: "orders" }],
      edges: [],
    };
    expect(parseReply("```json\n" + JSON.stringify(file) + "\n```")).toEqual({ ok: true, kind: "file", file });
    // No format field, but nodes and edges: still a file.
    const bare = { nodes: file.nodes, edges: [] };
    expect(parseReply(JSON.stringify(bare))).toEqual({ ok: true, kind: "file", file: bare });
  });

  it("explains empty, missing, broken and wrong-shaped replies", () => {
    expect(parseReply("   ")).toMatchObject({ ok: false, error: "Paste your AI's reply first." });
    expect(parseReply("I can't help with that.")).toMatchObject({ ok: false, error: "There's no JSON in the reply." });
    const cut = parseReply('```json\n[{ "op": "add_node", "kind": "Kafka topic", "label": "or');
    expect(cut.ok).toBe(false);
    if (!cut.ok) expect(cut.error).toMatch(/couldn't be read/);
    expect(parseReply('{ "hello": "world" }')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/isn't a list of ops/),
    });
    expect(parseReply('[{ "op": "add_node" }, { "label": "x" }]')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Item 2 isn't an op/),
    });
    expect(parseReply("[]")).toMatchObject({ ok: false, error: expect.stringMatching(/empty list/) });
  });
});
