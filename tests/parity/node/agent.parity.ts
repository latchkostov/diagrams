// What agents see (WebMCP, docs/research and src/ai/webmcp): the tool list with its schemas, and each tool's
// output for fixed inputs, through the real tools and adapter on a fake editor (the canonical one from
// src/ai/webmcp/adapter.test.ts). check_diagram with simulations plays them with a fake clock.
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { DiagramFile } from "../../../src/model/types";
import type { EditorApi } from "../../../src/editor/types";
import { diagramDiff } from "../../../src/model/diagramDiff";
import { buildTools, type WebMcpHost } from "../../../src/ai/webmcp/tools";
import { toModelContextTool } from "../../../src/ai/webmcp/adapter";
import { EDIT_TOOLS, LIVE_TOOLS } from "../../../src/ai/webmcp/toolList";
import { allDiagrams, examples } from "../lib/corpus";
import { expectGolden } from "../lib/golden";

beforeEach(() => {
  // check_diagram's simulation budget is wall-clock time; a still clock never runs out.
  vi.spyOn(performance, "now").mockReturnValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The app as agents reach it: an editor holding `start`, and the host around it. */
function session(start: DiagramFile) {
  let d = structuredClone(start);
  const applied: unknown[] = [];
  const editor = {
    getDiagram: () => d,
    applyDiagram: (next: DiagramFile) => {
      const diff = diagramDiff(d, next);
      if (diff.hasChanges) d = next;
      return diff;
    },
  } as unknown as EditorApi;
  const host: WebMcpHost = {
    getEditor: () => editor,
    // What the AI panel records, without its history key (a timestamp) and the editor itself.
    onApplied: (change) => {
      const rest: Record<string, unknown> = { ...(change as unknown as Record<string, unknown>) };
      delete rest.historyKey;
      delete rest.editor;
      applied.push(rest);
    },
    newDiagram: async () => editor,
    shareLink: async () => ({ url: "https://example.invalid/#d=parity", length: 34 }),
  };
  const tools = Object.fromEntries(buildTools(host).map((def) => [def.name, toModelContextTool(def)]));
  const call = async (name: string, input: Record<string, unknown>) => {
    const out = await tools[name].execute(input);
    const text = out.content.map((c) => c.text).join("\n");
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Plain text (describe_diagram's default format).
    }
    return { isError: out.isError ?? false, output: parsed };
  };
  return { call, get: () => d, applied, host };
}

it("tool list", () => {
  const tools = buildTools(session(examples[0].diagram).host).map((t) => {
    const mcp = toModelContextTool(t) as unknown as Record<string, unknown>;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      annotations: t.annotations,
      inputSchema: t.inputSchema,
      adapterKeys: Object.keys(mcp),
    };
  });
  expectGolden("agent/tools.json", { edit: [...EDIT_TOOLS], live: [...LIVE_TOOLS], tools });
});

describe("describe_diagram and check_diagram", () => {
  for (const { slug, diagram } of allDiagrams)
    it(slug, async () => {
      const { call } = session(diagram);
      const first = diagram.nodes[0]?.id;
      expectGolden(`agent/describe/${slug}.json`, {
        text: await call("describe_diagram", {}),
        json: await call("describe_diagram", { format: "json" }),
        ...(first ? { focus: await call("describe_diagram", { focus: [first], limit: 10 }) } : {}),
      });
      expectGolden(`agent/check/${slug}.json`, {
        all: await call("check_diagram", {}),
        warnings: await call("check_diagram", { include: "warnings" }),
        oneRule: await call("check_diagram", { rules: ["dead-letter", "capacity"] }),
        ...(diagram.simulations?.length ? { simulations: await call("check_diagram", { simulations: true }) } : {}),
      });
    });
});

const QUERIES: Record<string, unknown>[] = [
  { query: "kafka" },
  { query: "Kafka topic" },
  { query: "postgres" },
  { query: "queue", limit: 10 },
  { query: "azure function" },
  { query: ".NET consumer" },
  { query: "api gateway", category: "network" },
  { query: "redis cache" },
  { query: "s3 bucket" },
  { query: "lambda" },
  { query: "load balancer" },
  { query: "firewall", limit: 10 },
  { query: "openai" },
  { query: "claude" },
  { query: "event hub" },
  { query: "service bus topic" },
  { query: "browser", category: "clients" },
  { query: "grafana", category: "observability" },
  { query: "key vault", category: "security" },
  { query: "snowflake", category: "data" },
  { query: "zzzz-no-such-thing" },
  { query: "k8s deployment" },
];

it("find_stencils", async () => {
  const { call } = session(examples[0].diagram);
  const out: Record<string, unknown> = {};
  for (const q of QUERIES) out[JSON.stringify(q)] = await call("find_stencils", q);
  expectGolden("agent/find-stencils.json", out);
});

/** One edit script per example: every op kind, a bad reference and a dry run, against the example's own ids. */
function script(d: DiagramFile): Record<string, unknown>[][] {
  const [a, b, c] = d.nodes.map((n) => n.id);
  const edge = d.edges[0];
  return [
    [
      { op: "add_node", kind: "Kafka topic", label: "parity.events", key: "t" },
      { op: "connect", from: a, to: "t" },
    ],
    [
      { op: "add_node", kind: ".NET consumer", label: "Parity reader", key: "r", props: { replicas: 3 } },
      { op: "connect", from: "parity.events", to: "r", kind: "async", label: "reads" },
      { op: "add_node", kind: "Azure Key Vault", label: "Parity secrets", key: "kv" },
      { op: "connect", from: "r", to: "kv", relation: "secret" },
    ],
    ...(edge
      ? [[{ op: "insert_between", from: edge.from, to: edge.to, kind: "RabbitMQ queue", label: "buffer" }]]
      : []),
    [{ op: "update", target: b ?? a, label: "Renamed by parity", props: { latencyMs: 120 } }],
    [{ op: "update", target: c ?? a, kind: "AWS Lambda" }],
    [{ op: "add_boundary", label: "Parity zone", members: [a, b].filter(Boolean) }],
    [{ op: "add_note", text: "Pinned by the parity harness", near: a }],
    [{ op: "set_meta", title: "Parity edit", direction: "TB" }],
    [{ op: "remove", targets: ["Parity reader"] }],
    [{ op: "connect", from: "no-such-node", to: a }],
    [{ op: "add_node", kind: "Postgres", label: "Dry run only" }],
  ];
}

describe("edit_diagram and set_simulation", () => {
  for (const { slug, diagram } of examples)
    it(slug, async () => {
      const { call, get, applied } = session(diagram);
      const steps: unknown[] = [];
      const ops = script(diagram);
      for (const [i, batch] of ops.entries())
        steps.push(await call("edit_diagram", { ops: batch, ...(i === ops.length - 1 ? { dryRun: true } : {}) }));
      const [source, , target] = get().nodes.map((n) => n.id);
      steps.push(
        await call("set_simulation", {
          title: "Parity rush",
          durationSec: 20,
          traffic: [
            { from: source, pattern: "constant", ratePerSec: 20, durationSec: 10 },
            { from: source, pattern: "burst", count: 50, startSec: 5, durationSec: 2, messageType: "ParityBurst" },
            { from: source, pattern: "ramp", ratePerSec: 1, toRatePerSec: 30, startSec: 0, durationSec: 8 },
            {
              from: source,
              pattern: "spike",
              ratePerSec: 5,
              toRatePerSec: 40,
              startSec: 12,
              durationSec: 4,
              peakSec: 1,
            },
          ],
          events: [{ atSec: 6, node: target ?? source, do: "down", note: "It goes down" }],
          expectations: [{ label: "Nothing dropped", metric: "dropped", node: target ?? source, op: "==", value: 0 }],
        }),
      );
      steps.push(await call("set_simulation", { title: "Bad", traffic: [{ from: "nobody", pattern: "constant" }] }));
      expectGolden(`agent/edit/${slug}.json`, { steps, applied, diagram: get() });
    });
});
