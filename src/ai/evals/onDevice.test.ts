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

/** A fake session; a retry ("That failed: …") is answered as the first prompt was. */
const answering = (answer: (prompt: string) => string) => async () => {
  let first: string | undefined;
  return { prompt: async (input: string) => answer((first ??= input)) };
};

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

  it("a case whose session or reply hangs fails as a timeout and the run goes on", async () => {
    const cases = onDeviceCases.filter((c) => c.id === "edit-dlq" || c.id === "create-1");
    let calls = 0;
    const results = await runOnDeviceEvals(
      () => {
        calls++;
        // The first case never gets a session; every later session answers perfectly.
        if (calls === 1) return new Promise(() => undefined);
        return answering((prompt) => {
          const request = prompt.slice(prompt.lastIndexOf("Request: ") + 9);
          const c = onDeviceCases.find((x) => x.request === request)!;
          return reply(perfectEdits[c.id] ?? perfectCreate(c.request));
        })();
      },
      cases,
      undefined,
      undefined,
      20,
    );
    expect(results.map((r) => r.pass)).toEqual([false, true]);
    expect(results[0].note).toMatch(/took too long/);
    expect(results[0].category).toBe("model error");
  });

  it("a model that adds the wrong thing fails, with the reason", async () => {
    const cases = onDeviceCases.filter((c) => c.id === "edit-dlq" || c.id === "create-1");
    // Connected, so complete as far as the reply can tell, but the wrong stencil: the check says so.
    const wrong = [
      { op: "add", key: "g", kind: "Grafana", label: "Dashboards" },
      { op: "connect", from: "Inventory service", to: "g" },
    ];
    // Into an empty diagram, the request's components are missing: the completeness check says which.
    const lone = [{ op: "add", kind: "Grafana", label: "Dashboards" }];
    const results = await runOnDeviceEvals(
      answering((prompt) => reply(prompt.includes("Empty diagram.") ? lone : wrong)),
      cases,
    );
    expect(results.map((r) => r.pass)).toEqual([false, false]);
    expect(results[0].note).toMatch(/no new node of the right kind/);
    expect(results[1].note).toMatch(/^You added Dashboards but not the Kafka topic orders.created/);
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
    expect(failureCategory("You added Redis but not the Go service, and nothing connects them.")).toBe("omission");
    expect(failureCategory('Don\'t reuse names from the examples ("sample-worker")')).toBe("leak");
    expect(failureCategory("The reply ran on past 2400 characters.")).toBe("runaway");
    expect(failureCategory("ECS workload isn't in the diagram. Add it with an add op")).toBe("reference");
    expect(failureCategory("A connection can't start and end at the same node; add the missing component first.")).toBe(
      "structure",
    );
    const results = await runOnDeviceEvals(
      answering((prompt) =>
        reply(
          prompt.includes("Empty diagram.")
            ? [{ op: "add", kind: "Grafana", label: "Dashboards" }]
            : [
                { op: "add", key: "g", kind: "Grafana", label: "Dashboards" },
                { op: "connect", from: "Inventory service", to: "g" },
              ],
        ),
      ),
      cases,
    );
    expect(results.map((r) => r.category)).toEqual(["stencil", "omission"]);
    expect(results[0].output).toContain("Dashboards → grafana");
    const md = resultsMarkdown(results);
    expect(md).toMatch(/Failures by category: (stencil 1 · omission 1|omission 1 · stencil 1)\./);
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

  it("replays round 2's failures (two runs, Chrome 154): fixed outright, or on the retry the feedback asks for", async () => {
    const add = (key: string, kind: string, label: string) => ({ op: "add", key, kind, label });
    const link = (from: string, to: string) => ({ op: "connect", from, to });
    // Answers shaped like the recorded mistakes; a second entry is the corrected retry.
    const replies: Record<string, object[][]> = {
      // Right label, wrong kind: fixed outright.
      "create-6": [[add("f", "Lambda", "Azure function"), add("q", "Service Bus queue", "Jobs"), link("q", "f")]],
      "create-16": [[add("m", "browser", "Mobile Client"), add("g", "API gateway", "Gateway"), link("m", "g")]],
      "create-17": [
        [add("fd", "Amazon API Gateway", "Front Door"), add("app", "App Service", "Web app"), link("fd", "app")],
      ],
      "create-19": [[add("p", "Go service", "Prometheus"), add("g", "Grafana", "Grafana"), link("p", "g")]],
      "create-22": [[add("s", "Lambda", "Scheduler"), add("w", ".NET service", "Worker"), link("s", "w")]],
      // A component connected but never added (and, for create-25, drawn backwards): fixed outright.
      "create-15": [[add("cosmos", "Cosmos DB", "Container Cosmos DB"), link("Container Apps", "cosmos")]],
      "create-25": [[add("ddb", "DynamoDB", "Table"), link("ddb", "ECS workload")]],
      // "between" with one side connected: fixed outright.
      "edit-between": [[add("c", "Redis cache", "Orders cache"), link("Order service", "c")]],
      // Omissions and a leak: the feedback asks, the retry answers.
      "create-12": [
        [add("r", "Redis cache", "Redis")],
        [add("g", "Go service", "API"), add("r", "Redis cache", "Redis"), link("g", "r")],
      ],
      "create-21": [
        [add("e", "Event Hubs", "IoT Events")],
        [add("d", "IoT devices", "Devices"), add("e", "Event Hubs", "IoT Events"), link("d", "e")],
      ],
      "create-28": [
        [add("d", "generic database", "Database")],
        [add("c", "component", "Component"), add("d", "generic database", "Database"), link("c", "d")],
      ],
      "create-23": [
        [add("p", "external partner", "Partner"), add("g", "API gateway", "sample-gateway"), link("p", "g")],
        [add("p", "external partner", "Partner"), add("w", "webhook", "Webhook"), link("p", "w")],
      ],
    };
    const cases = onDeviceCases.filter((c) => c.id in replies);
    const feedback: Record<string, string> = {};
    const results = await runOnDeviceEvals(async () => {
      let id = "";
      let n = 0;
      return {
        prompt: async (input: string) => {
          id ||= cases.find((c) => input.endsWith(`Request: ${c.request}`))!.id;
          if (n) feedback[id] = input;
          const answers = replies[id];
          return reply(answers[Math.min(n++, answers.length - 1)]);
        },
      };
    }, cases);
    expect(results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.note}`)).toEqual([]);
    const tries = Object.fromEntries(results.map((r) => [r.id, r.attempts]));
    for (const id of [
      "create-6",
      "create-16",
      "create-17",
      "create-19",
      "create-22",
      "create-15",
      "create-25",
      "edit-between",
    ])
      expect(tries[id], id).toBe(1);
    for (const id of ["create-12", "create-21", "create-28", "create-23"]) expect(tries[id], id).toBe(2);
    expect(feedback["create-12"]).toMatch(/You added Redis but not the Go service, and nothing connects them/);
    expect(feedback["create-23"]).toMatch(/Don't reuse names from the examples/);
  });
});
