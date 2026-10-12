import { describe, expect, it } from "vitest";
import kafka from "../../examples/kafka-order-pipeline.json";
import type { DiagramFile } from "../../model/types";
import type { CompactOp } from "./compactOps";
import { withoutLeaked } from "./leaks";
import { runOnDevice } from "./pipeline";

// Round 5 review: a placeholder from the examples ("sample-app"), cleaned out of the retry's reply. Which
// ops depend on it follows the shared reference precedence; what's left is applied only when it can be
// checked against the whole request.

const KAFKA = kafka as unknown as DiagramFile;
const EMPTY: DiagramFile = { format: "diagrams/v1", title: "t", nodes: [], edges: [] };
const node = (id: string, label: string, stencil = "service.go") => ({ id, stencil, label, x: 0, y: 0 });
/** Worker, API and DB, with API -> DB; and an existing node whose name looks like a placeholder. */
const SMALL: DiagramFile = {
  ...EMPTY,
  nodes: [node("w", "Worker"), node("a", "API"), node("d", "DB", "postgres"), node("s", "Sample App")],
  edges: [{ id: "e1", from: "a", to: "d" }],
};
const json = (ops: object[], summary = "s") => JSON.stringify({ summary, ops });
const leak = (extra: object = {}) => ({
  op: "add",
  key: "sample-app",
  kind: "Go service",
  label: "sample-app",
  ...extra,
});

/** The request through the pipeline, the model giving `raw` both times. */
async function twice(diagram: DiagramFile, request: string, raw: string) {
  let calls = 0;
  const r = await runOnDevice({
    session: {
      prompt: async () => {
        calls++;
        return raw;
      },
    },
    diagram,
    request,
  });
  return { r, calls };
}

describe("which ops a placeholder takes with it", () => {
  const kept = (ops: object[], diagram = SMALL) => withoutLeaked(ops as CompactOp[], "sample-app", diagram);

  it("keeps an op on an existing element, even one named like the placeholder's label", () => {
    // The leaked node is labelled "Worker" too: "Worker" is still the existing Worker (exact label first).
    const connect = { op: "connect", from: "Worker", to: "DB" };
    const rename = { op: "rename", target: "DB", label: "Store" };
    expect(kept([leak({ label: "Worker" }), connect, rename])).toEqual([connect, rename]);
    // An existing "Sample App" isn't the placeholder "sample-app".
    const toSample = { op: "connect", from: "API", to: "Sample App" };
    expect(kept([leak(), toSample])).toEqual([toSample]);
    // The same with Kafka's Payments service.
    const pay = { op: "rename", target: "Payments service", label: "Billing service" };
    expect(kept([leak({ label: "Payments service" }), pay], KAFKA)).toEqual([pay]);
  });

  it("drops what refers to it by key, label, kind, or a label written without spaces", () => {
    const partner = { op: "add", key: "partner", kind: "external partner", label: "Partner" };
    const hook = { op: "add", key: "hook", kind: "webhook", label: "Webhook" };
    const good = { op: "connect", from: "partner", to: "hook" };
    expect(
      kept(
        [
          partner,
          hook,
          leak({ key: "app", label: "sample-app" }),
          good,
          { op: "connect", from: "hook", to: "Go service" },
          { op: "connect", from: "partner", to: "app" },
        ],
        EMPTY,
      ),
    ).toEqual([partner, hook, good]);
    expect(
      kept([partner, leak({ label: "Wrong Service" }), { op: "connect", from: "partner", to: "WrongService" }], EMPTY),
    ).toEqual([partner]);
  });

  it("never leaves half an insertion: the removal of the bypassed connection goes with it", () => {
    const remove = { op: "remove", target: "API -> DB" };
    expect(
      kept([
        { op: "insert_between", key: "c", kind: "Redis cache", label: "sample-app", from: "API", to: "DB" },
        remove,
      ]),
    ).toEqual([]);
    // The same insertion written as an add, two connections and the removal.
    expect(
      kept([
        leak({ kind: "Redis cache" }),
        { op: "connect", from: "API", to: "sample-app" },
        { op: "connect", from: "sample-app", to: "DB" },
        remove,
      ]),
    ).toEqual([]);
    // A removal of an unrelated connection stays.
    const other = { op: "remove", target: "API -> DB" };
    expect(kept([leak(), { op: "connect", from: "Worker", to: "sample-app" }, other])).toEqual([other]);
  });
});

describe("a cleaned retry is applied only when it can be checked against the whole request", () => {
  const partner = { op: "add", key: "partner", kind: "external partner", label: "Partner" };
  const hook = { op: "add", key: "hook", kind: "webhook", label: "Webhook" };
  const request = "An external partner sends a webhook";

  it("succeeds without completion when the rest is complete, and cleans a summary that names it", async () => {
    for (const [summary, expected] of [
      ["Partner sends to sample-app", "Applied the request"],
      ["Partner sends a webhook", "Partner sends a webhook"],
    ]) {
      const raw = json([partner, hook, leak(), { op: "connect", from: "partner", to: "hook" }], summary);
      const { r, calls } = await twice(EMPTY, request, raw);
      expect(calls).toBe(2);
      expect(r).toMatchObject({ ok: true, attempts: 2, summary: expected });
      if (!r.ok) continue;
      expect(r.completed).toBeUndefined();
      expect(r.plan.next.nodes.map((n) => n.stencil).sort()).toEqual(["client.partner", "generic.webhook"]);
      expect(r.plan.next.edges).toHaveLength(1);
    }
  });

  it("fails a compound request on an existing diagram rather than apply part of it", async () => {
    const { r } = await twice(
      KAFKA,
      "Rename Payments service to Billing service and add a Redis cache after Order service",
      json([
        { op: "rename", target: "Payments service", label: "Billing service" },
        leak({ kind: "Redis cache" }),
        { op: "connect", from: "Order service", to: "sample-app" },
      ]),
    );
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Don't reuse names from the examples/) });
  });

  it("fails when a requested edit was the placeholder, or a half insertion would delete a connection", async () => {
    const edit = await twice(
      SMALL,
      "Rename Worker to Billing and connect Worker to DB",
      json([
        { op: "rename", target: "Worker", label: "sample-ledger" },
        { op: "connect", from: "Worker", to: "DB" },
      ]),
    );
    expect(edit.r.ok).toBe(false);
    const insert = await twice(
      SMALL,
      "Put a Redis cache between API and DB",
      json(
        [
          { op: "insert_between", key: "c", kind: "Redis cache", label: "sample-app", from: "API", to: "DB" },
          { op: "remove", target: "API -> DB" },
        ],
        "Inserted a cache",
      ),
    );
    expect(insert.r.ok).toBe(false);
  });

  it("applies a request of renames and kind changes when every one is there and nothing else", async () => {
    const request2 = "Rename Payments service to Billing service and make Orders database a MongoDB";
    const both = [
      { op: "rename", target: "Payments service", label: "Billing service" },
      { op: "change_kind", target: "Orders database", kind: "MongoDB" },
    ];
    const { r } = await twice(KAFKA, request2, json([leak({ label: "Payments service" }), ...both]));
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    if (r.ok) {
      expect(r.plan.next.nodes.find((n) => n.id === "payments")?.label).toBe("Billing service");
      expect(r.plan.next.nodes.find((n) => n.id === "order-db")?.stencil).toBe("mongodb");
      expect(r.plan.next.nodes).toHaveLength(KAFKA.nodes.length);
    }
    // One of the two missing: fails.
    const half = await twice(KAFKA, request2, json([leak(), both[0]]));
    expect(half.r.ok).toBe(false);
  });
});
