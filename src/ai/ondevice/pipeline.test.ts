import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { diagramContext, INITIAL_PROMPTS, REPLY_SCHEMA, requestPrompt, runOnDevice, toOps } from "./pipeline";

const diagram = kafka as unknown as DiagramFile;
const reply = (summary: string, ops: object[]) => JSON.stringify({ summary, ops });
const DLQ = reply("Added a dead-letter queue after Inventory service", [
  { op: "add", kind: "dead-letter queue", label: "inventory-dlq" },
  { op: "connect", from: "Inventory service", to: "inventory-dlq", flow: "message" },
]);

/** A fake session answering in order. */
const session = (...replies: (string | Error)[]) => ({
  prompt: vi.fn(async (_input: string, _opts?: { signal?: AbortSignal }) => {
    const next = replies.shift() ?? reply("", []);
    if (next instanceof Error) throw next;
    return next;
  }),
});

describe("toOps", () => {
  it("maps the compact ops onto the core's ops", () => {
    const r = toOps(
      reply("s", [
        { op: "add", kind: "Redis cache", label: "cache", sublabel: "orders" },
        { op: "connect", from: "API", to: "cache", flow: "request" },
        { op: "connect", from: "A", to: "B", flow: "message" },
        { op: "rename", target: "API", label: "Orders API" },
        { op: "change", target: "cache", kind: "Memcached" },
        { op: "remove", target: "A -> B" },
      ]),
    );
    expect(r).toEqual({
      ok: true,
      summary: "s",
      ops: [
        { op: "add_node", kind: "Redis cache", label: "cache", sublabel: "orders" },
        { op: "connect", from: "API", to: "cache", kind: "sync" },
        { op: "connect", from: "A", to: "B", kind: "async" },
        { op: "update", target: "API", label: "Orders API" },
        { op: "update", target: "cache", kind: "Memcached" },
        { op: "remove", targets: ["A -> B"] },
      ],
    });
  });

  it("says what's missing, op by op", () => {
    expect(toOps("not json")).toEqual({ ok: false, error: "The reply wasn't JSON." });
    expect(toOps("{}")).toMatchObject({ ok: false, error: 'The reply needs an "ops" array.' });
    expect(toOps(reply("", []))).toMatchObject({ ok: false, error: "The reply has no ops." });
    expect(toOps(reply("", [{ op: "add", label: "x" }]))).toMatchObject({
      error: 'Op 1 (add) needs "kind" and "label".',
    });
    expect(toOps(reply("", [{ op: "connect", from: "a" }]))).toMatchObject({
      error: 'Op 1 (connect) needs "from" and "to".',
    });
    expect(toOps(reply("", [{ op: "fly" }]))).toMatchObject({ ok: false });
    expect(
      toOps(
        reply(
          "",
          Array.from({ length: 17 }, () => ({ op: "remove", target: "x" })),
        ),
      ),
    ).toMatchObject({
      error: "Use at most 16 ops.",
    });
  });
});

describe("the prompt", () => {
  it("names nodes by label, ids only where labels repeat", () => {
    const d = { ...diagram, nodes: [...diagram.nodes, { ...diagram.nodes[0], id: "shopper-2" }] } as DiagramFile;
    const text = diagramContext(d);
    expect(text).toContain("- Inventory service: Java Service");
    expect(text).toContain("- shopper: Web Browser");
    expect(text).toContain("- shopper-2: Web Browser");
    expect(text).toContain("- Order service -> orders.created.v1 (message)");
    expect(text).toContain("- Order service -> Orders database (request)");
  });

  it("stays within its budget, the selection and its neighbours first", () => {
    const text = diagramContext(diagram, ["dashboard"], 300);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text.split("\n")[2]).toContain("Order operations");
    expect(text).toMatch(/\(\d+ more nodes not shown\)/);
  });

  it("an empty diagram says so; the selection is listed as Copy for AI names it", () => {
    expect(diagramContext({ ...diagram, nodes: [], edges: [] })).toBe("Empty diagram.");
    const text = requestPrompt(diagram, " Add a DLQ ", [{ id: "inventory", label: "Inventory service", kind: "node" }]);
    expect(text).toContain('Selected:\n- node "inventory" "Inventory service"');
    expect(text.endsWith("Request: Add a DLQ")).toBe(true);
  });

  it("primes the model with a system prompt and three worked examples that parse", () => {
    expect(INITIAL_PROMPTS[0].role).toBe("system");
    const answers = INITIAL_PROMPTS.filter((p) => p.role === "assistant");
    expect(answers).toHaveLength(3);
    for (const a of answers) expect(toOps(a.content).ok).toBe(true);
    expect(REPLY_SCHEMA.properties.ops.items.properties.op.enum).toEqual([
      "add",
      "connect",
      "rename",
      "change",
      "remove",
    ]);
  });
});

describe("runOnDevice", () => {
  it("a good reply becomes a plan (applied by the caller as one turn)", async () => {
    const s = session(DLQ);
    const statuses: string[] = [];
    const r = await runOnDevice({ session: s, diagram, request: "Add a DLQ", onStatus: (x) => statuses.push(x) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(1);
    expect(r.summary).toBe("Added a dead-letter queue after Inventory service");
    expect(r.plan.summary).toBe("+1 node, +1 connection");
    expect(r.plan.next.nodes.find((n) => n.label === "inventory-dlq")?.stencil).toBe("generic.queue");
    expect(r.plan.changed.length).toBeGreaterThan(0);
    expect(statuses).toEqual(["thinking", "applying"]);
    expect(s.prompt.mock.calls[0][1]).toMatchObject({ responseConstraint: REPLY_SCHEMA });
  });

  it("retries once with the error fed back, then succeeds", async () => {
    const s = session(reply("", [{ op: "remove", target: "Shipping service" }]), DLQ);
    const r = await runOnDevice({ session: s, diagram, request: "Add a DLQ" });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(s.prompt.mock.calls[1][0]).toMatch(/^That failed: [\s\S]*Shipping service/);
  });

  it("gives up after the retry, with nothing applied", async () => {
    const bad = reply("", [{ op: "connect", from: "Nowhere", to: "Inventory service" }]);
    const r = await runOnDevice({ session: session(bad, bad), diagram, request: "x" });
    expect(r).toMatchObject({ ok: false, attempts: 2 });
  });

  it("a diagram too big for the context says so at once", async () => {
    const r = await runOnDevice({
      session: session(new DOMException("too big", "QuotaExceededError")),
      diagram,
      request: "x",
    });
    expect(r).toMatchObject({ ok: false, tooBig: true, attempts: 1 });
  });

  it("cancel rejects with the abort and asks nothing more", async () => {
    const controller = new AbortController();
    const s = {
      prompt: vi.fn(
        (_input: string, opts?: { signal?: AbortSignal }) =>
          new Promise<string>((_, reject) =>
            opts?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
          ),
      ),
    };
    const run = runOnDevice({ session: s, diagram, request: "x", signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(s.prompt).toHaveBeenCalledTimes(1);
  });
});
