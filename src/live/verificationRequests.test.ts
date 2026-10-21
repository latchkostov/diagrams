import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import payment from "../examples/slow-payment-provider.json";
import { TroubleWatcher, type TroubleAction } from "./observedTrouble";
import type { ThreadFixRequest } from "./threadFixPlan";
import { LiveController } from "./controller";
import { TroubleTracker } from "./useObservedTrouble";

// PR #225 delta review: outstanding fix verifications stay bounded. One request may be in flight per tracker; the
// latest revision goes next, and nothing in between ever reaches the worker.

type Held = { request: ThreadFixRequest; resolve: (fix: TroubleAction | undefined) => void; reject: () => void };

function held() {
  const requests: Held[] = [];
  const verify = (request: ThreadFixRequest) =>
    new Promise<TroubleAction | undefined>((resolve, reject) =>
      requests.push({ request, resolve, reject: () => reject(new Error("worker")) }),
    );
  return { requests, verify };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

it("scripted property changes after the trouble appears never queue more verification", () => {
  const d = structuredClone(payment) as DiagramFile;
  d.simulations![0].timeline!.push(
    ...Array.from({ length: 50 }, (_, i) => ({
      atMs: 15010 + i * 100,
      action: { do: "props" as const, node: "orders", props: { latencyMs: 5 + (i % 2) } },
    })),
  );
  const c = new LiveController(d);
  const { requests, verify } = held();
  const tracker = new TroubleTracker(c, verify);
  const stop = tracker.subscribe(() => {});
  try {
    c.selectSimulation(d.simulations![0]);
    for (let i = 0; i < 150; i++) c.step(100);
    expect(requests).toHaveLength(1);
    for (let i = 0; i < 50; i++) c.step(100);
    expect(c.effectiveProps("orders").latencyMs).toBe(6);
    expect(requests).toHaveLength(1);
  } finally {
    stop();
    c.dispose();
  }
});

it("a burst of live changes keeps one request in flight and sends only the latest revision next", async () => {
  const d = payment as DiagramFile;
  const c = new LiveController(d);
  const { requests, verify } = held();
  const tracker = new TroubleTracker(c, verify);
  const stop = tracker.subscribe(() => {});
  const fix = { kind: "add-timeout" as const, edge: "pay", deadlineMs: 600 };
  try {
    c.selectSimulation(d.simulations![0]);
    for (let i = 0; i < 150; i++) c.step(100);
    expect(requests).toHaveLength(1);
    for (let i = 0; i < 50; i++) c.setNodeProps("orders", { latencyMs: 5 + (i % 2) });
    expect(requests).toHaveLength(1);
    // The stale answer is ignored, and the next request carries the newest revision.
    requests[0].resolve(fix);
    await settle();
    expect(tracker.current()?.action.kind).toBe("events");
    expect(requests).toHaveLength(2);
    expect(requests[1].request.context.revision).toBe(c.verificationRevision);
    expect(requests[1].request.context.controls.at(-1)?.op).toMatchObject({ kind: "props", patch: { latencyMs: 6 } });
    // A failed worker request frees the slot without retrying the same revision.
    requests[1].reject();
    await settle();
    expect(requests).toHaveLength(2);
    expect(tracker.current()?.action.kind).toBe("events");
    c.setNodeProps("orders", { latencyMs: 5 });
    expect(requests).toHaveLength(3);
    requests[2].resolve(fix);
    await settle();
    expect(tracker.current()?.action).toEqual(fix);
  } finally {
    stop();
    c.dispose();
  }
});

it("a tracker nobody subscribes to sends nothing, and an unsubscribed one starts no follow-up", async () => {
  const c = new LiveController(payment as DiagramFile);
  const observe = vi.spyOn(TroubleWatcher.prototype, "observe").mockImplementation(() => [
    {
      key: "threads-exhausted:checkout",
      kind: "threads-exhausted",
      node: "checkout",
      headline: "",
      announce: "",
      detail: "",
      action: { kind: "free-thread", edge: "pay" },
    },
  ]);
  const { requests, verify } = held();
  try {
    // React may construct and discard a tracker (StrictMode): construction alone sends nothing.
    const tracker = new TroubleTracker(c, verify);
    c.publish();
    expect(requests).toHaveLength(0);
    const stop = tracker.subscribe(() => {});
    expect(requests).toHaveLength(1);
    c.setNodeProps("orders", { latencyMs: 6 });
    stop();
    requests[0].resolve(undefined);
    await settle();
    expect(requests).toHaveLength(1);
    // Subscribed again, the latest revision is verified.
    const again = tracker.subscribe(() => {});
    expect(requests).toHaveLength(2);
    expect(requests[1].request.context.revision).toBe(c.verificationRevision);
    again();
  } finally {
    observe.mockRestore();
    c.dispose();
  }
});

it("healthy publications never materialize the verification context", () => {
  const c = new LiveController(payment as DiagramFile);
  const context = vi.spyOn(c, "verificationContext");
  const tracker = new TroubleTracker(c, held().verify);
  const stop = tracker.subscribe(() => {});
  try {
    c.setTraffic(true);
    for (let i = 0; i < 50; i++) c.step(100);
    expect(context).not.toHaveBeenCalled();
  } finally {
    stop();
    c.dispose();
  }
});
