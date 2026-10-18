import { expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { installChecksMeasurement } from "../../tests/e2e/checks-measurement";

it("reuses only an identical restored prefix, keeping real measured posts and deferred results", async () => {
  class FakeWorker extends EventTarget {
    sent: unknown[] = [];
    constructor(_url?: string | URL, _options?: WorkerOptions) {
      super();
    }
    postMessage(message: unknown) {
      this.sent.push(message);
    }
  }
  const browser = { Worker: FakeWorker };
  const stringify = vi.fn(JSON.stringify);
  const state = runInNewContext(`(${installChecksMeasurement.toString()})()`, {
    window: browser,
    MessageEvent,
    structuredClone,
    queueMicrotask,
    JSON: { stringify },
  }) as ReturnType<typeof installChecksMeasurement>;
  const worker = new browser.Worker("checks", { name: "checks" });
  const received: unknown[] = [];
  worker.addEventListener("message", (event) => received.push((event as MessageEvent).data));
  const diagram = { title: "same prefix" };
  const response = { id: 1, result: { findings: [] } };
  const reply = (data: unknown) => worker.dispatchEvent(new MessageEvent("message", { data }));

  state.held = true;
  worker.postMessage({ id: 1, diagram });
  reply(response);
  expect(worker.sent).toHaveLength(1);
  expect(received).toEqual([]);
  expect(stringify).not.toHaveBeenCalled();
  state.release();
  expect(received).toEqual([response]);
  expect(stringify).toHaveBeenCalledOnce();

  state.restoring = true;
  worker.postMessage({ id: 2, diagram: structuredClone(diagram) });
  await setImmediate();
  expect(worker.sent).toHaveLength(1);
  expect(state.cacheHits).toBe(1);
  expect(received.at(-1)).toEqual({ ...response, id: 2 });
  expect(received.at(-1)).not.toBe(response);

  const changed = { title: "different prefix" };
  worker.postMessage({ id: 3, diagram: changed });
  expect(worker.sent).toHaveLength(2);
  reply({ ...response, id: 3 });
  state.restoring = false;
  state.held = true;
  worker.postMessage({ id: 4, diagram: changed });
  expect(worker.sent).toHaveLength(3);
  expect(state.nativeChecks).toBe(3);
  expect(state.cacheHits).toBe(1);
  reply({ ...response, id: 4 });
  expect(received).toHaveLength(3);
  state.release();
  expect(received.at(-1)).toEqual({ ...response, id: 4 });

  // A failed worker must still exercise the application's real synchronous fallback.
  state.held = true;
  worker.postMessage({ id: 5, diagram: changed });
  reply({ id: 5, error: "worker failed" });
  expect(received.at(-1)).toEqual({ id: 5, error: "worker failed" });

  state.restoring = true;
  worker.postMessage({ id: 6, diagram: changed, plan: true });
  expect(worker.sent).toHaveLength(5);
  const other = new browser.Worker("other", { name: "particles" });
  const visible = vi.fn();
  other.addEventListener("message", visible);
  other.postMessage({ id: 7, diagram: changed });
  other.dispatchEvent(new MessageEvent("message", { data: response }));
  expect(other.sent).toHaveLength(1);
  expect(visible).toHaveBeenCalledOnce();
});
