import { describe, expect, it } from "vitest";
import { getStencil } from "../../stencils/registry";
import { onDeviceCases, resultsMarkdown, runOnDeviceEvals } from "./onDevice";
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
});
