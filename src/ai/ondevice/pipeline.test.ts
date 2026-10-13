import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { applyOps } from "../index";
import { diagramEvals } from "../evals/corpus";
import { onDeviceCases } from "../evals/onDevice";
import { EXAMPLE_NAMES } from "./examples";
import { completeFromRequest } from "./replyChecks";
import { elementNames, replySchema } from "./replySchema";
import type { DiagramOp } from "../index";
import {
  diagramContext,
  INITIAL_PROMPTS,
  isTransient,
  planError,
  resetSchemaTier,
  currentSchemaTier,
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
    // Each answer, checked against its own request and the examples' diagram.
    const sample = applyOps(EMPTY, [
      { op: "add_node", kind: "Batch Job", label: "sample-batch", key: "g" },
      { op: "add_node", kind: "Kafka topic", label: "sample.jobs", key: "j" },
      { op: "add_node", kind: ".NET service", label: "sample-worker", key: "w" },
      { op: "add_node", kind: "PostgreSQL", label: "sample-store", key: "s" },
      { op: "connect", from: "g", to: "j" },
      { op: "connect", from: "j", to: "w" },
      { op: "connect", from: "w", to: "s", kind: "sync" },
    ]).diagram;
    for (const [i, a] of INITIAL_PROMPTS.entries()) {
      if (a.role !== "assistant") continue;
      const user = INITIAL_PROMPTS[i - 1].content;
      const request = user.slice(user.lastIndexOf("Request: ") + 9);
      const diagram = user.startsWith("Empty diagram.") ? EMPTY : sample;
      const worker = sample.nodes.find((n) => n.label === "sample-worker")!;
      const scope = user.includes("this = ") ? [{ id: worker.id, label: worker.label, kind: "node" as const }] : [];
      const r = toOps(a.content, { diagram, request, scope });
      expect(r.ok ? "" : r.error).toBe("");
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
  // Names from the examples once turned up in answers to unrelated requests ("Orders API", "Quill
  // gateway"). The examples' own components are now obvious placeholders, and their new nodes are named
  // as each example's request names them.
  const requests = [...diagramEvals.map((e) => e.description), ...onDeviceCases.map((c) => c.request)];
  const kafkaLabels = diagram.nodes.map((n) => n.label);

  it("the placeholder names appear in no eval request and no example diagram label", () => {
    expect(EXAMPLE_NAMES).toEqual(expect.arrayContaining(["sample-batch", "sample.jobs", "sample-worker"]));
    for (const name of EXAMPLE_NAMES) {
      expect(name.startsWith("sample")).toBe(true);
      for (const text of [...requests, ...kafkaLabels])
        expect(text.toLowerCase().includes(name.toLowerCase()), `${name} in "${text}"`).toBe(false);
    }
  });

  it("each example answer names its new nodes from its own request, or with a placeholder", () => {
    for (const [i, p] of INITIAL_PROMPTS.entries()) {
      if (p.role !== "assistant") continue;
      const request = INITIAL_PROMPTS[i - 1].content.toLowerCase();
      for (const o of JSON.parse(p.content).ops as { op: string; label?: string }[])
        if (o.label) expect(request.includes(o.label.toLowerCase()), o.label).toBe(true);
    }
  });

  it('leave no gateway, API or ingress to copy (run 3 reused "sample-gateway")', () => {
    for (const name of EXAMPLE_NAMES) expect(name).not.toMatch(/gateway|api|ingress|front/i);
  });

  it("nor do they reuse the old examples' names", () => {
    for (const old of ["Orders API", "orders-db", "billing-worker", "orders.created", "Partner", "Quill", "Zephyr"])
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
    // The reply's shape for this request: its targets are the diagram's own names.
    expect(
      JSON.stringify((s.prompt.mock.calls[0][1] as { responseConstraint?: object } | undefined)?.responseConstraint),
    ).toContain('"Inventory service"');
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
    // On a fake clock: two replies of 20 ms each, and nothing waits longer than that (the default timeout is
    // seconds). Advancing a little past 40 ms settles it, however busy the machine is.
    vi.useFakeTimers();
    try {
      let settled: unknown;
      void runOnDevice({
        session: hang(),
        freshSession: async () => hang(),
        diagram,
        request: "Add a DLQ",
        replyTimeoutMs: 20,
      }).then((r) => (settled = r));
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toMatchObject({ ok: false, error: TIMED_OUT, attempts: 2 });
    } finally {
      vi.useRealTimers();
    }
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

describe("round 2: runaways", () => {
  it("the reply schema bounds every string and array, and closes every object", () => {
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "string" && !n.enum) expect(n.maxLength, `${path} maxLength`).toBeTypeOf("number");
      if (n.type === "array") expect(n.maxItems, `${path} maxItems`).toBeTypeOf("number");
      if (n.type === "object") expect(n.additionalProperties, `${path} additionalProperties`).toBe(false);
      for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
    };
    walk(REPLY_SCHEMA, "reply");
    expect(REPLY_SCHEMA.properties.ops.maxItems).toBe(6);
    expect(REPLY_SCHEMA.properties.summary.maxLength).toBe(160);
  });

  /**
   * A streaming session like Chrome's: one generation at a time (an overlapping prompt is rejected), and
   * an aborted prompt leaves no trace in its history. Records each prompt and its signal.
   */
  const streaming = (...replies: ("runaway" | string)[]) => {
    const prompts: string[] = [];
    const signals: AbortSignal[] = [];
    let active = false;
    return {
      prompts,
      signals,
      prompt: vi.fn(async () => "unused"),
      destroy: vi.fn(),
      promptStreaming: (input: string, opts?: { signal?: AbortSignal }) => {
        if (active) throw new DOMException("A prompt is already running.", "InvalidStateError");
        active = true;
        prompts.push(input);
        signals.push(opts!.signal!);
        const next = replies.shift()!;
        opts?.signal?.addEventListener("abort", () => (active = false));
        return new ReadableStream<string>({
          pull(controller) {
            if (opts?.signal?.aborted) return controller.error(new DOMException("aborted", "AbortError"));
            if (next === "runaway") controller.enqueue('{"summary":"' + "x".repeat(500));
            else {
              controller.enqueue(next);
              controller.close();
              active = false;
            }
          },
        });
      },
    };
  };

  it("aborts a runaway generation, then resends the whole request with the feedback", async () => {
    const s = streaming("runaway", DLQ);
    const r = await runOnDevice({ session: s, diagram, request: "Add a DLQ" });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    // The first generation was stopped before the retry began (the fake rejects overlapping prompts).
    expect(s.signals[0].aborted).toBe(true);
    // The retry stands alone: an aborted prompt leaves the history, so it carries the diagram and request.
    expect(s.prompts[1].startsWith(s.prompts[0])).toBe(true);
    expect(s.prompts[1]).toMatch(/Request: Add a DLQ\n\nYour last reply ran on past 2400 characters/);
  });

  it("goes on in a fresh session when there is one, and keeps the runaway's start for the evals", async () => {
    const first = streaming("runaway");
    const fresh = streaming(DLQ);
    const r = await runOnDevice({ session: first, freshSession: async () => fresh, diagram, request: "Add a DLQ" });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(fresh.prompts[0]).toContain("Request: Add a DLQ");
    expect(fresh.destroy).toHaveBeenCalled();
    const twice = await runOnDevice({ session: streaming("runaway", "runaway"), diagram, request: "x" });
    expect(twice).toMatchObject({ ok: false, error: "The reply ran on past 2400 characters." });
    expect(!twice.ok && twice.output?.raw.startsWith('{"summary":"xxx')).toBe(true);
  });

  it("an unknown reference to something not in the diagram says to add it", () => {
    const empty: DiagramFile = { ...EMPTY };
    expect(
      planError({ i: 1, ref: "ECS workload", error: 'Unknown reference "ECS workload".', candidates: [] }, empty),
    ).toBe("ECS workload isn't in the diagram. Add it with an add op (with a key), then connect it by that key.");
    expect(
      planError(
        {
          i: 0,
          ref: "Inventory servce",
          error: 'Unknown reference "Inventory servce".',
          candidates: [{ id: "inventory", label: "Inventory service" }],
        },
        diagram,
      ),
    ).toMatch(/Labels it could mean: "Inventory service"/);
  });
});

describe("round 3: schema tiers and the completion after the retry", () => {
  it("a NotSupportedError moves to the next schema tier, remembered for the page", async () => {
    resetSchemaTier();
    const tiers: string[] = [];
    const s = {
      prompt: vi.fn(async (_input: string, opts?: { responseConstraint?: object }) => {
        const text = JSON.stringify(opts?.responseConstraint);
        const tier = text.includes('"enum":["rename"]')
          ? "typed"
          : text.includes("anyOf")
            ? "rich"
            : text.includes('"enum":["Storefront') || text.includes('"Inventory service"')
              ? "enums"
              : "plain";
        tiers.push(tier);
        if (tier !== "plain") throw new DOMException("unsupported keyword", "NotSupportedError");
        return DLQ;
      }),
    };
    const r = await runOnDevice({ session: s, diagram, request: "Add a DLQ" });
    expect(r).toMatchObject({ ok: true, attempts: 1 });
    expect(tiers).toEqual(["typed", "rich", "enums", "plain"]);
    expect(currentSchemaTier()).toBe("plain");
    resetSchemaTier();
  });

  it("a simple request still incomplete after the retry is completed from its words (create-11, create-21)", async () => {
    const empty: DiagramFile = { ...EMPTY };
    const onlyApi = reply("", [{ op: "add", key: "api", kind: ".NET API", label: "API" }]);
    const r = await runOnDevice({
      session: session(onlyApi, onlyApi),
      diagram: empty,
      request: "A .NET API stores documents in MongoDB",
    });
    expect(r).toMatchObject({ ok: true, attempts: 2, completed: true });
    if (!r.ok) return;
    const label = new Map(r.plan.next.nodes.map((n) => [n.id, `${n.label}:${n.stencil}`]));
    expect(r.plan.next.edges.map((e) => `${label.get(e.from)} -> ${label.get(e.to)}`)).toEqual([
      "API:service.dotnet -> MongoDB:mongodb",
    ]);
    const onlyHub = reply("", [{ op: "add", key: "hub", kind: "Event Hubs", label: "IoT Events" }]);
    const iot = await runOnDevice({
      session: session(onlyHub, onlyHub),
      diagram: empty,
      request: "IoT devices publish into Event Hubs",
    });
    expect(iot).toMatchObject({ ok: true, completed: true });
    if (!iot.ok) return;
    const names = new Map(iot.plan.next.nodes.map((n) => [n.id, n.stencil]));
    expect(iot.plan.next.edges.map((e) => `${names.get(e.from)} -> ${names.get(e.to)}`)).toEqual([
      "client.iot -> azure.event-hubs",
    ]);
  });

  it("completion keeps out of anything but a simple request into an empty diagram", () => {
    const partial = [{ op: "add_node" as const, kind: "Go service", label: "API", key: "~api" }];
    expect(completeFromRequest(partial, "A Go service uses Redis cache", diagram)).toBeNull();
    expect(completeFromRequest(partial, "Add a Go service and a Redis cache", EMPTY)).toBeNull();
    expect(
      completeFromRequest(
        partial,
        "A Go service uses Redis cache, writes to Postgres, calls Stripe and sends to SQS",
        EMPTY,
      ),
    ).toBeNull();
    // "consumes" flows back; "consumed by" forward.
    const consumes = completeFromRequest([], "Java consumes a Kafka topic", EMPTY)!;
    expect(consumes.filter((o) => o.op === "connect")).toEqual([
      { op: "connect", from: "~req-2", to: "~req-1", kind: "async" },
    ]);
    const passive = completeFromRequest([], "A Kafka topic consumed by a Java worker", EMPTY)!;
    expect(passive.filter((o) => o.op === "connect")).toEqual([
      { op: "connect", from: "~req-1", to: "~req-2", kind: "async" },
    ]);
  });
});

describe("round 3 review: completion only when it can't guess wrong", () => {
  const go = [{ op: "add_node" as const, kind: "Go service", label: "API", key: "~api" }];
  const connects = (ops: DiagramOp[] | null) => {
    const label = new Map<string, string>([["~api", "API"]]);
    for (const o of ops ?? []) if (o.op === "add_node") label.set(o.key!, o.label);
    return (ops ?? [])
      .filter((o): o is Extract<DiagramOp, { op: "connect" }> => o.op === "connect")
      .map((o) => `${label.get(o.from)} -> ${label.get(o.to)} ${o.kind}`);
  };

  it.each([
    "Add a Go service; do not connect it to Redis cache yet",
    "A Go service calls MongoDB, but do not connect them yet",
    "A Go service must not connect to Redis cache",
    "A Go service uses Redis cache, but leave it unconnected",
    "A Go service calls a Java service, but do not connect PostgreSQL",
    "A Go service uses Redis cache without a connection",
  ])("declines a negated or prohibited relationship: %s", (request) => {
    expect(completeFromRequest(go, request, EMPTY)).toBeNull();
  });

  it("declines without an explicit relating verb for every pair (order alone isn't a relation)", () => {
    expect(completeFromRequest(go, "Add a Go service and a Redis cache", EMPTY)).toBeNull();
    expect(completeFromRequest(go, "A Go service, a Redis cache and MongoDB", EMPTY)).toBeNull();
  });

  it("a shared subject is a star, not a chain", () => {
    expect(connects(completeFromRequest(go, "A Go service uses Redis cache and writes to MongoDB", EMPTY))).toEqual([
      "API -> Redis cache sync",
      "API -> MongoDB sync",
    ]);
  });

  it("keeps database calls service -> database, and sets the flow kind", () => {
    expect(connects(completeFromRequest(go, "A Go service reads from PostgreSQL", EMPTY))).toEqual([
      "API -> PostgreSQL sync",
    ]);
    expect(connects(completeFromRequest([], "IoT devices publish into Event Hubs", EMPTY))).toEqual([
      "IoT devices -> Event Hubs async",
    ]);
    expect(connects(completeFromRequest([], "Java consumes a Kafka topic", EMPTY))).toEqual([
      "Kafka topic -> Java async",
    ]);
  });

  it("keeps two components of one technology apart by their words; declines when it can't", () => {
    const request = "A billing Go service calls a shipping Go service which uses PostgreSQL";
    const partial: DiagramOp[] = [
      { op: "add_node", kind: "Go service", label: "shipping", key: "~ship" },
      { op: "add_node", kind: "Go service", label: "billing", key: "~bill" },
      { op: "connect", from: "~bill", to: "~ship", kind: "sync" },
    ];
    const done = completeFromRequest(partial, request, EMPTY)!;
    expect(done.filter((o) => o.op === "connect")).toContainEqual({
      op: "connect",
      from: "~ship",
      to: "~req-3",
      kind: "sync",
    });
    const anonymous: DiagramOp[] = [
      { op: "add_node", kind: "Go service", label: "Service A", key: "~a" },
      { op: "add_node", kind: "Go service", label: "Service B", key: "~b" },
    ];
    expect(completeFromRequest(anonymous, request, EMPTY)).toBeNull();
  });

  it("through runOnDevice: a prohibited relation is never completed into a connection", async () => {
    const onlyGo = reply("", [{ op: "add", key: "api", kind: "Go service", label: "API" }]);
    const r = await runOnDevice({
      session: session(onlyGo, onlyGo),
      diagram: EMPTY,
      request: "A Go service uses Redis cache, but leave it unconnected",
    });
    expect(r.ok && r.plan.next.edges.length).toBeFalsy();
  });
});

describe("round 3 review: constrained targets keep identity", () => {
  const two: DiagramFile = {
    ...EMPTY,
    nodes: [
      { id: "api", stencil: "service.go", label: "API", x: 0, y: 0 },
      { id: "db", stencil: "postgres", label: "DB", x: 300, y: 0 },
    ],
    edges: [
      { id: "write", from: "api", to: "db", kind: "sync" },
      { id: "audit", from: "api", to: "db", kind: "sync" },
    ],
    groups: [{ id: "g1", label: "Azure", x: 0, y: 0, width: 10, height: 10 }],
  };

  it("parallel connections are named by id, never by an ambiguous pair; boundaries are named too", () => {
    const { edges, boundaries } = elementNames(two, "Remove the audit connection");
    expect(edges).toEqual(["write", "audit"]);
    expect(boundaries).toEqual(["Azure"]);
    const schema = JSON.stringify(replySchema(two, "x"));
    expect(schema).not.toContain('"API -> DB"');
    expect(schema).toContain('"Azure"');
  });

  it('"this" is the selected connection or boundary as a target', () => {
    for (const scope of [
      [{ id: "audit", label: "API → DB", kind: "connection" as const }],
      [{ id: "g1", label: "Azure", kind: "boundary" as const }],
    ]) {
      const r = toOps(reply("", [{ op: "remove", target: "this" }]), { diagram: two, scope, request: "Remove this" });
      expect(r).toMatchObject({ ok: true, ops: [{ op: "remove", targets: [scope[0].id] }] });
      expect(JSON.stringify(replySchema(two, "Remove this", scope))).toContain('"this"');
    }
  });

  it("a giant imported label can't break a normal request", async () => {
    const giant: DiagramFile = {
      ...EMPTY,
      nodes: [
        { id: "huge", stencil: "service.go", label: "x".repeat(100_000), x: 0, y: 0 },
        { id: "pay", stencil: "service.go", label: "Payments", x: 300, y: 0 },
      ],
      edges: [],
    };
    const names = elementNames(giant, "Rename Payments to Billing");
    expect(names.nodes).toEqual(["Payments", "huge"]);
    expect(JSON.stringify(replySchema(giant, "Rename Payments to Billing")).length).toBeLessThan(5000);
    const r = await runOnDevice({
      session: session(reply("Renamed", [{ op: "rename", target: "Payments", label: "Billing" }])),
      diagram: giant,
      request: "Rename Payments to Billing",
    });
    expect(r).toMatchObject({ ok: true });
  });
});
