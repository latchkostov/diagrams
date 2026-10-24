import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import storm from "../examples/retry-storm.json";
import { describeDiagram } from "./describe";
import { recommendedQueue } from "../sim/resiliencePresets";

it("describe exposes executed retries, idempotency, backoff, amplification and queue defaults in both formats", () => {
  const d = structuredClone(storm) as DiagramFile;
  const json = JSON.parse(describeDiagram(d, { format: "json" }));
  const pay = json.edges.find((e: { id: string }) => e.id === "pay");
  expect(pay.resilience).toMatchObject({
    attempts: 3,
    idempotent: false,
    budget: null,
    breaker: null,
    priority: "normal",
    backoff: { baseMs: 0, growth: 1, jitter: 0 },
    amplification: { steady: 1, worst: 3 },
  });
  expect(json.nodes.find((n: { id: string }) => n.id === "payments").queue).toEqual({
    limit: null,
    order: "fifo",
    whenFull: "reject-new",
    maxWaitMs: null,
    waitCeilingMs: null,
  });
  const text = describeDiagram(d);
  expect(text).toContain(`resilience=${JSON.stringify(pay.resilience)}`);
  expect(text).toContain(" queue=");
  d.nodes.find((n) => n.id === "payments")!.props!.queue = recommendedQueue(300, 80, 32, 400);
  const queued = JSON.parse(describeDiagram(d, { format: "json" })).nodes.find(
    (n: { id: string }) => n.id === "payments",
  ).queue;
  expect(queued).toMatchObject({ limit: 80, order: "lifo", maxWaitMs: 200, waitCeilingMs: (80 / 600) * 1000 });
  d.planning!.revision = "p3-w1";
  const legacy = JSON.parse(describeDiagram(d, { format: "json" }));
  expect(legacy.edges.some((e: { resilience?: unknown }) => e.resilience)).toBe(false);
  expect(legacy.nodes.some((n: { queue?: unknown }) => n.queue)).toBe(false);
});

it("describe's blocking hold includes expected retry attempts and backoff", () => {
  const d = structuredClone(storm) as DiagramFile;
  d.edges.find((e) => e.id === "pay")!.props!.caller = {
    wait: "blocking",
    deadlineMs: 300,
    retry: { maxAttempts: 3, strategy: "fixed", backoffMs: 100, retryOn: ["transient"] },
  };
  d.nodes.find((n) => n.id === "payments")!.props!.failureRate = 0.5;
  const read = () => JSON.parse(describeDiagram(d, { format: "json" }));
  const before = read(),
    pay = before.edges.find((e: { id: string }) => e.id === "pay");
  expect(pay.resilience.amplification.steady).toBe(1.75);
  const hold = before.nodes.find((n: { id: string }) => n.id === "checkout").requestsWait.holdMs;
  d.edges.find((e) => e.id === "pay")!.props!.caller = { wait: "blocking", deadlineMs: 300 };
  expect(hold).toBeGreaterThan(read().nodes.find((n: { id: string }) => n.id === "checkout").requestsWait.holdMs);
});
