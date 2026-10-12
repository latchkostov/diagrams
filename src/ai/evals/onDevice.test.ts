import { describe, expect, it } from "vitest";
import { getStencil } from "../../stencils/registry";
import { failureCategory, onDeviceCases, resultsMarkdown, runOnDeviceEvals } from "./onDevice";
import { diagramEvals } from "./corpus";

// The harness itself, with a fake model that answers perfectly (and one that answers badly): every case
// is reachable through the on-device op format, and the scoring tells right from wrong.

const reply = (ops: object[]) => JSON.stringify({ summary: "done", ops });

const perfectEdits: Record<string, object[]> = {
  "edit-dlq": [
    { op: "add", kind: "dead-letter queue", label: "inventory-dlq" },
    { op: "connect", from: "Inventory service", to: "inventory-dlq", flow: "message" },
  ],
  "edit-rename": [{ op: "rename", target: "Payments service", label: "Billing service" }],
  "edit-remove": [{ op: "remove", target: "Notification dedupe" }],
  "edit-between": [
    { op: "add", kind: "Redis cache", label: "orders-cache" },
    { op: "remove", target: "Order service -> Orders database" },
    { op: "connect", from: "Order service", to: "orders-cache", flow: "request" },
    { op: "connect", from: "orders-cache", to: "Orders database", flow: "request" },
  ],
  "edit-connect": [{ op: "connect", from: "Payments service", to: "Commerce metrics", flow: "request" }],
  "edit-change": [{ op: "change", target: "Orders database", kind: "MongoDB" }],
  "edit-email": [
    { op: "add", kind: "email", label: "Email" },
    { op: "connect", from: "Notification service", to: "Email", flow: "message" },
  ],
  "edit-selection": [
    { op: "add", kind: "queue", label: "payments-retry" },
    { op: "connect", from: "payments", to: "payments-retry", flow: "message" },
  ],
};

/** The corpus's own ops, written in the on-device format. */
function perfectCreate(request: string): object[] {
  const evalCase = diagramEvals.find((e) => e.description === request)!;
  const labels = new Map<string, string>();
  // The on-device format has no boundaries; the case scores stencils and connections only.
  return evalCase.turns[0].ops.flatMap((op) => {
    if (op.op === "add_boundary") return [];
    if (op.op === "add_node") {
      labels.set(op.key ?? op.label, op.label);
      return { op: "add", kind: op.kind, label: op.label };
    }
    if (op.op === "connect")
      return { op: "connect", from: labels.get(op.from) ?? op.from, to: labels.get(op.to) ?? op.to };
    throw new Error(`unexpected ${op.op}`);
  });
}

const answering = (answer: (prompt: string) => string) => async () => ({
  prompt: async (input: string) => answer(input),
});

describe("on-device evals", () => {
  it("the cases name real stencils and nodes", () => {
    expect(onDeviceCases.length).toBeGreaterThanOrEqual(30);
    for (const id of ["mongodb", "generic.email", "redis.cache", "generic.queue"]) expect(getStencil(id).id).toBe(id);
  });

  it("a perfect model passes every case", async () => {
    const results = await runOnDeviceEvals(
      answering((prompt) => {
        const request = prompt.slice(prompt.lastIndexOf("Request: ") + 9);
        const c = onDeviceCases.find((x) => x.request === request)!;
        return reply(perfectEdits[c.id] ?? perfectCreate(c.request));
      }),
    );
    expect(results.filter((r) => !r.pass)).toEqual([]);
    expect(resultsMarkdown(results)).toContain(`Pass rate: **${results.length}/${results.length} (100%)**`);
  });

  it("a model that adds the wrong thing fails, with the reason", async () => {
    const cases = onDeviceCases.filter((c) => c.id === "edit-dlq" || c.id === "create-1");
    const results = await runOnDeviceEvals(
      answering(() => reply([{ op: "add", kind: "Grafana", label: "Dashboards" }])),
      cases,
    );
    expect(results.map((r) => r.pass)).toEqual([false, false]);
    expect(results[0].note).toMatch(/no new node of the right kind/);
    expect(results[1].note).toMatch(/^missing /);
    expect(resultsMarkdown(results)).toContain("| edit-dlq |");
  });

  it("rejects reversed connections", async () => {
    const [c] = onDeviceCases.filter((x) => x.id === "create-1");
    const ops = perfectCreate(c.request).map((op) => {
      const o = op as { op: string; from?: string; to?: string };
      return o.op === "connect" ? { ...o, from: o.to, to: o.from } : o;
    });
    const [r] = await runOnDeviceEvals(
      answering(() => reply(ops)),
      [c],
    );
    expect(r.pass).toBe(false);
    expect(r.note).toMatch(/^reversed connection/);
  });

  it("rejects wrong endpoints with the correct edge count", async () => {
    const [c] = onDeviceCases.filter((x) => x.id === "create-1");
    // Same nodes and as many connections, but both leave the first node.
    const ops = perfectCreate(c.request);
    const adds = ops.filter((o) => (o as { op: string }).op === "add") as { label: string }[];
    const wrong = [
      ...adds.map((a) => ({ op: "add", kind: (a as { kind?: string }).kind, label: a.label })),
      { op: "connect", from: adds[0].label, to: adds[1].label },
      { op: "connect", from: adds[0].label, to: adds[2].label },
    ];
    const [r] = await runOnDeviceEvals(
      answering(() => reply(wrong)),
      [c],
    );
    expect(r.pass).toBe(false);
    expect(r.note).toMatch(/^no connection /);
  });

  it("sorts failures into categories, with a summary line and the model's output", async () => {
    expect(failureCategory('Unknown reference "Orders API". Use an id from candidates.')).toBe("reference");
    expect(
      failureCategory("reversed connection: service.java -> kafka.topic instead of kafka.topic -> service.java"),
    ).toBe("direction");
    expect(failureCategory("missing service.go")).toBe("stencil");
    expect(failureCategory("the direct connection is still there")).toBe("structure");
    expect(failureCategory("the new node isn't connected where asked")).toBe("structure");
    expect(failureCategory('Op 1 (rename) needs "target" and the new "label".')).toBe("format");
    expect(failureCategory("An unknown error occurred: kErrorUnknown")).toBe("model error");
    const cases = onDeviceCases.filter((c) => c.id === "edit-dlq" || c.id === "create-1");
    const results = await runOnDeviceEvals(
      answering(() => reply([{ op: "add", kind: "Grafana", label: "Dashboards" }])),
      cases,
    );
    expect(results.map((r) => r.category)).toEqual(["stencil", "stencil"]);
    expect(results[0].output).toContain("Dashboards → grafana");
    const md = resultsMarkdown(results);
    expect(md).toContain("Failures by category: stencil 2.");
    expect(md).toContain("| Case | Request | Result | Tries | ms | Category | Note | Model output |");
  });

  it("replays the 2026-10-12 failures (Chrome 154) with replies shaped like the model's: they pass now", async () => {
    // Each reply makes the mistake the run recorded; the pipeline (not the model) now gets it right.
    const replies: Record<string, object[]> = {
      // Answered a kind change with "rename".
      "edit-change": [{ op: "rename", target: "Orders database", kind: "MongoDB" }],
      // Plain connects for "between", the direct connection left in place.
      "edit-between": [
        { op: "add", key: "cache", kind: "Redis cache", label: "Orders cache" },
        { op: "connect", from: "Order service", to: "cache", flow: "request" },
        { op: "connect", from: "cache", to: "Orders database", flow: "request" },
      ],
      // The new queue left unconnected.
      "edit-selection": [{ op: "add", kind: "queue", label: "payments-retry" }],
      // "Python job" names the new node by words of its kind.
      "create-4": [
        { op: "add", kind: "Python", label: "Job" },
        { op: "add", kind: "pg", label: "pg" },
        { op: "connect", from: "Python job", to: "pg", flow: "request" },
      ],
      // Drawn against "consumes".
      "create-5": [
        { op: "add", kind: "Kafka topic", label: "Events" },
        { op: "add", kind: "Java", label: "Consumer" },
        { op: "connect", from: "Consumer", to: "Events", flow: "message" },
      ],
      "create-6": [
        { op: "add", kind: "Service Bus queue", label: "Jobs" },
        { op: "add", kind: "Azure function", label: "Runner" },
        { op: "connect", from: "Runner", to: "Jobs", flow: "message" },
      ],
      // Kinds the resolver missed: "a processor", "PubSub", "Redis".
      "create-9": [
        { op: "add", kind: "Kinesis", label: "Stream" },
        { op: "add", kind: "a processor", label: "Processor" },
        { op: "connect", from: "Stream", to: "Processor", flow: "message" },
      ],
      "create-12": [
        { op: "add", kind: "Go service", label: "API" },
        { op: "add", kind: "Redis", label: "Cache" },
        { op: "connect", from: "API", to: "Cache", flow: "request" },
      ],
      // Named by kind, not label.
      "create-15": [
        { op: "add", kind: "Container Apps", label: "Orders" },
        { op: "add", kind: "Cosmos DB", label: "State" },
        { op: "connect", from: "Container Apps", to: "Cosmos DB", flow: "request" },
      ],
      // Bare "RabbitMQ" is an exchange: fair for "routes".
      "create-18": [
        { op: "add", kind: "RabbitMQ", label: "Tasks" },
        { op: "add", kind: "Java worker", label: "Worker" },
        { op: "connect", from: "Tasks", to: "Worker", flow: "message" },
      ],
    };
    const transientFor = new Set(["edit-rename"]);
    const rename = [{ op: "rename", target: "Payments service", label: "Billing service" }];
    const thrown = new Set<string>();
    const cases = onDeviceCases.filter((c) => c.id in replies || transientFor.has(c.id));
    const results = await runOnDeviceEvals(
      async () => ({
        prompt: async (input: string) => {
          const c = cases.find((x) => input.endsWith(`Request: ${x.request}`))!;
          // edit-rename's first prompt fails as Chrome's did; the fresh session's answers.
          if (transientFor.has(c.id) && !thrown.has(c.id)) {
            thrown.add(c.id);
            throw new DOMException("An unknown error occurred: kErrorUnknown", "UnknownError");
          }
          return reply(replies[c.id] ?? rename);
        },
      }),
      cases,
    );
    expect(results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.note}`)).toEqual([]);
    expect(results).toHaveLength(Object.keys(replies).length + 1);
  });
});
