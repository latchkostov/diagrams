import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { diagramEvals } from "../evals/corpus";
import { onDeviceCases } from "../evals/onDevice";
import {
  diagramContext,
  INITIAL_PROMPTS,
  isTransient,
  REPLY_SCHEMA,
  requestPrompt,
  runOnDevice,
  TIMED_OUT,
  toOps,
} from "./pipeline";

const diagram = kafka as unknown as DiagramFile;
const EMPTY: DiagramFile = { format: "diagrams/v1", title: "t", nodes: [], edges: [] };
const reply = (summary: string, ops: object[]) => JSON.stringify({ summary, ops });
const DLQ = reply("Added a dead-letter queue after Inventory service", [
  { op: "add", key: "dlq", kind: "dead-letter queue", label: "inventory-dlq" },
  { op: "connect", from: "Inventory service", to: "dlq", flow: "message" },
]);

/** A fake session answering in order. */
const session = (...replies: (string | Error)[]) => ({
  prompt: vi.fn(async (_input: string, _opts?: { signal?: AbortSignal }) => {
    const next = replies.shift() ?? reply("", []);
    if (next instanceof Error) throw next;
    return next;
  }),
  destroy: vi.fn(),
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

  it('spells out the selection as this = <id> "<label>"', () => {
    expect(diagramContext(EMPTY)).toBe("Empty diagram.");
    const one = requestPrompt(diagram, " Add a DLQ ", [{ id: "inventory", label: "Inventory service", kind: "node" }]);
    expect(one).toContain('this = inventory "Inventory service"');
    expect(one.endsWith("Request: Add a DLQ")).toBe(true);
    const two = requestPrompt(diagram, "x", [
      { id: "inventory", label: "Inventory service", kind: "node" },
      { id: "payments", label: "Payments service", kind: "node" },
    ]);
    expect(two).toContain('these = inventory "Inventory service", payments "Payments service"');
  });

  it("states the direction rules", () => {
    const system = INITIAL_PROMPTS[0].content;
    expect(system).toMatch(/consumes \/ reads from \/ subscribes to .* goes from B to A/);
    expect(system).toMatch(/calls \/ uses \/ writes to .* goes from A to B/);
  });

  it("primes the model with four worked examples that parse, with keys on every added node", () => {
    expect(INITIAL_PROMPTS[0].role).toBe("system");
    const answers = INITIAL_PROMPTS.filter((p) => p.role === "assistant");
    expect(answers).toHaveLength(4);
    for (const a of answers) {
      expect(toOps(a.content, { diagram: EMPTY }).ok).toBe(true);
      for (const op of JSON.parse(a.content).ops as { op: string; key?: string }[])
        if (op.op === "add" || op.op === "insert_between") expect(op.key).toBeTruthy();
    }
    expect(REPLY_SCHEMA.properties.ops.items.properties.op.enum).toEqual([
      "add",
      "connect",
      "insert_between",
      "rename",
      "change_kind",
      "remove",
    ]);
  });
});

describe("leakage guard", () => {
  // Names from the examples once turned up in answers to unrelated requests ("Orders API").
  const exampleNames = INITIAL_PROMPTS.filter((p) => p.role === "assistant").flatMap((p) =>
    (JSON.parse(p.content).ops as { label?: string; key?: string }[]).flatMap((o) => [o.label, o.key]),
  );
  const names = [...new Set(exampleNames.filter((n): n is string => !!n))];
  const requests = [...diagramEvals.map((e) => e.description), ...onDeviceCases.map((c) => c.request)];
  const kafkaLabels = diagram.nodes.map((n) => n.label);

  it("the examples' node names appear in no eval request and no example diagram label", () => {
    expect(names.length).toBeGreaterThan(5);
    for (const name of names)
      for (const text of [...requests, ...kafkaLabels])
        expect(text.toLowerCase().includes(name.toLowerCase()), `${name} in "${text}"`).toBe(false);
  });

  it("nor do they reuse the old examples' names", () => {
    for (const old of ["Orders API", "orders-db", "billing-worker", "orders.created", "Partner"])
      expect(JSON.stringify(INITIAL_PROMPTS)).not.toContain(old);
  });
});

describe("runOnDevice", () => {
  it("a good reply becomes a plan (applied by the caller as one turn), with the model's output", async () => {
    const s = session(DLQ);
    const statuses: string[] = [];
    const r = await runOnDevice({ session: s, diagram, request: "Add a DLQ", onStatus: (x) => statuses.push(x) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(1);
    expect(r.summary).toBe("Added a dead-letter queue after Inventory service");
    expect(r.plan.summary).toBe("+1 node, +1 connection");
    expect(r.plan.next.nodes.find((n) => n.label === "inventory-dlq")?.stencil).toBe("generic.queue");
    expect(statuses).toEqual(["thinking", "applying"]);
    expect(s.prompt.mock.calls[0][1]).toMatchObject({ responseConstraint: REPLY_SCHEMA });
    expect(r.output.raw).toBe(DLQ);
  });

  it("retries once with the error fed back, then succeeds", async () => {
    const s = session(reply("", [{ op: "remove", target: "Shipping service" }]), DLQ);
    const r = await runOnDevice({ session: s, diagram, request: "Add a DLQ" });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(s.prompt.mock.calls[1][0]).toMatch(/^That failed: [\s\S]*Shipping service/);
  });

  it("gives up after the retry, with nothing applied and the last reply kept", async () => {
    const bad = reply("", [{ op: "connect", from: "Nowhere", to: "Inventory service" }]);
    const r = await runOnDevice({ session: session(bad, bad), diagram, request: "x" });
    expect(r).toMatchObject({ ok: false, attempts: 2, output: { raw: bad } });
  });

  it("a transient Prompt API error is retried on a fresh session, without using up the retry", async () => {
    const broken = session(new DOMException("An unknown error occurred: kErrorUnknown", "UnknownError"));
    const fresh = session(DLQ);
    const r = await runOnDevice({ session: broken, freshSession: async () => fresh, diagram, request: "Add a DLQ" });
    expect(r).toMatchObject({ ok: true, attempts: 1 });
    expect(fresh.prompt.mock.calls[0][0]).toBe(broken.prompt.mock.calls[0][0]);
    expect(fresh.destroy).toHaveBeenCalled();
    expect(isTransient(new Error("An unknown error occurred: kErrorUnknown"))).toBe(true);
    expect(isTransient(new DOMException("no", "NotSupportedError"))).toBe(false);
    expect(isTransient(new DOMException("x", "AbortError"))).toBe(false);
  });

  it("a reply that never comes times out and the request goes on in a fresh session", async () => {
    let seen: AbortSignal | undefined;
    const hung = {
      prompt: vi.fn((_input: string, opts?: { signal?: AbortSignal }) => {
        seen = opts?.signal;
        return new Promise<string>(() => undefined);
      }),
      destroy: vi.fn(),
    };
    const fresh = session(DLQ);
    const r = await runOnDevice({
      session: hung,
      freshSession: async () => fresh,
      diagram,
      request: "Add a DLQ",
      replyTimeoutMs: 20,
    });
    expect(r).toMatchObject({ ok: true, attempts: 1 });
    // The hung prompt was told to stop.
    expect(seen?.aborted).toBe(true);
    expect(fresh.prompt.mock.calls[0][0]).toBe(hung.prompt.mock.calls[0][0]);
  });

  it("when every reply hangs it gives up with a timeout instead of waiting forever", async () => {
    const hang = () => ({ prompt: vi.fn(() => new Promise<string>(() => undefined)), destroy: vi.fn() });
    const t0 = Date.now();
    const r = await runOnDevice({
      session: hang(),
      freshSession: async () => hang(),
      diagram,
      request: "Add a DLQ",
      replyTimeoutMs: 20,
    });
    expect(r).toMatchObject({ ok: false, error: TIMED_OUT, attempts: 2 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("a fresh session that never arrives also times out", async () => {
    const r = await runOnDevice({
      session: session(new DOMException("An unknown error occurred: kErrorUnknown", "UnknownError")),
      freshSession: () => new Promise(() => undefined),
      diagram,
      request: "Add a DLQ",
      replyTimeoutMs: 20,
    });
    expect(r).toMatchObject({ ok: false, error: TIMED_OUT, attempts: 1 });
  });

  it("a cancel during a slow reply is still a cancel, not a timeout", async () => {
    const controller = new AbortController();
    const slow = {
      prompt: vi.fn(
        (_input: string, opts?: { signal?: AbortSignal }) =>
          new Promise<string>((_, reject) =>
            opts?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
          ),
      ),
      destroy: vi.fn(),
    };
    const running = runOnDevice({
      session: slow,
      diagram,
      request: "x",
      signal: controller.signal,
      replyTimeoutMs: 5000,
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
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
