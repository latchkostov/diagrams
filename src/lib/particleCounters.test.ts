import { afterEach, expect, it, vi } from "vitest";
import { installParticleCountersInPage } from "../../tests/e2e/particle-counters";

afterEach(() => vi.unstubAllGlobals());

function harness() {
  class NativeWorker extends EventTarget {
    sent: [unknown, unknown?][] = [];
    constructor(public url: string | URL) {
      super();
    }
    postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      this.sent.push([message, transfer]);
    }
  }
  vi.stubGlobal("window", { Worker: NativeWorker });
  installParticleCountersInPage();
  const probe = window.__particleCounters!;
  const worker = () => new window.Worker("/assets/particleWorker-test.js") as unknown as NativeWorker;
  const send = (worker: NativeWorker, data: unknown) => worker.dispatchEvent(new MessageEvent("message", { data }));
  return { probe, worker, send, NativeWorker };
}

it("observes paints without waiting for a UI publication and returns independent snapshots", () => {
  const h = harness();
  const worker = h.worker();
  h.send(worker, { type: "ack", epoch: 1, frames: 3, drawn: 42 });
  expect(h.probe.snapshot()).toEqual({ frames: 3, particles: 42 });
  h.probe.snapshot().frames = 99;
  expect(h.probe.snapshot().frames).toBe(3);
});

it("holds only paint reports, preserves their data and order, and does not block readback replies", () => {
  const h = harness();
  const worker = h.worker();
  const seen: unknown[] = [];
  worker.addEventListener("message", (event) => seen.push((event as MessageEvent).data));
  h.probe.holdReports();
  const ack = { type: "ack", epoch: 1, frames: 1, drawn: 4, buf: new ArrayBuffer(4) };
  const later = { type: "ack", epoch: 1, frames: 2, drawn: 5 };
  const readback = { type: "probe", id: 9 };
  h.send(worker, ack);
  h.send(worker, later);
  h.send(worker, readback);
  expect(h.probe.snapshot()).toEqual({ frames: 2, particles: 5 });
  expect(h.probe.held()).toBe(2);
  expect(seen).toEqual([readback]);
  h.probe.releaseReports();
  expect(seen).toEqual([readback, ack, later]);
  expect(seen[1]).toBe(ack);
  expect(h.probe.snapshot().frames).toBe(2);
  expect(h.probe.held()).toBe(0);
});

it("rejects stale epochs and late reports from a replaced worker", () => {
  const h = harness();
  const first = h.worker();
  h.send(first, { type: "ack", epoch: 3, frames: 10, drawn: 40 });
  h.send(first, { type: "ack", epoch: 2, frames: 20, drawn: 50 });
  expect(h.probe.snapshot().frames).toBe(10);
  h.send(first, { type: "ack", epoch: 4, frames: 1, drawn: 2 });
  expect(h.probe.snapshot().frames).toBe(1);
  const second = h.worker();
  h.send(first, { type: "ack", epoch: 5, frames: 30, drawn: 70 });
  expect(h.probe.snapshot().frames).toBe(0);
  h.send(second, { type: "ack", epoch: 1, frames: 2, drawn: 8 });
  expect(h.probe.snapshot()).toEqual({ frames: 2, particles: 8 });
});

it("inherits both native transfer overloads unchanged", () => {
  const h = harness();
  const worker = h.worker();
  const data = new ArrayBuffer(4);
  worker.postMessage({ frame: 1 }, [data]);
  worker.postMessage({ frame: 2 }, { transfer: [data] });
  expect(worker.postMessage).toBe(h.NativeWorker.prototype.postMessage);
  expect(worker.sent).toEqual([
    [{ frame: 1 }, [data]],
    [{ frame: 2 }, { transfer: [data] }],
  ]);
});
