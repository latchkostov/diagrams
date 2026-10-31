import { afterEach, expect, it, vi } from "vitest";
import { installThreadVerificationInPage } from "../../tests/e2e/thread-verification";

afterEach(() => vi.unstubAllGlobals());

function harness(holdFirst = false) {
  const turns: (() => void)[] = [];
  class Channel {
    port1 = { onmessage: undefined as (() => void) | undefined, close() {} };
    port2 = { postMessage: () => turns.push(() => this.port1.onmessage?.()), close() {} };
  }
  class TestWorker extends EventTarget {
    sent: [unknown, unknown?][] = [];
    failure?: Error;
    postMessage(message: unknown, transferOrOptions?: unknown) {
      if (this.failure) throw this.failure;
      this.sent.push([message, transferOrOptions]);
    }
    reply(id: number) {
      this.dispatchEvent(new MessageEvent("message", { data: { id } }));
    }
  }
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", TestWorker);
  vi.stubGlobal("MessageChannel", Channel);
  installThreadVerificationInPage({ holdFirst });
  const state = window.__threadVerification;
  if (!state) throw new Error("Expected the verification probe");
  return {
    state,
    worker: () => new TestWorker(),
    flush: () => {
      while (turns.length) turns.shift()?.();
    },
  };
}

it("waits for the cold verifier's first real request and reply", async () => {
  const h = harness();
  let ready = false;
  const waiting = h.state.whenSettled().then(() => (ready = true));
  h.flush();
  await Promise.resolve();
  expect(ready).toBe(false);
  const worker = h.worker();
  worker.postMessage({ id: 1, threadFix: {} });
  h.flush();
  await Promise.resolve();
  expect(ready).toBe(false);
  worker.reply(1);
  h.flush();
  await waiting;
  expect(ready).toBe(true);
});

it("preserves both transfer overloads and ignores non-verification traffic and unrelated replies", async () => {
  const h = harness();
  const worker = h.worker();
  const buffer = new ArrayBuffer(4);
  worker.postMessage({ type: "frame" }, [buffer]);
  worker.postMessage({ type: "frame" }, { transfer: [buffer] });
  expect(worker.sent).toEqual([
    [{ type: "frame" }, [buffer]],
    [{ type: "frame" }, { transfer: [buffer] }],
  ]);
  expect(h.state.requested).toBe(0);
  worker.postMessage({ id: 3, threadFix: {} });
  expect(h.state.requests).toEqual([{}]);
  worker.reply(99);
  expect(h.state.pending()).toBe(1);
  const waiting = h.state.whenSettled();
  worker.reply(3);
  h.flush();
  await waiting;
});

it("does not mistake the gap before a stale flight's latest replacement for completion", async () => {
  const h = harness();
  const worker = h.worker();
  worker.postMessage({ id: 1, threadFix: {} });
  let ready = false;
  const waiting = h.state.whenSettled().then(() => (ready = true));
  worker.reply(1);
  queueMicrotask(() => worker.postMessage({ id: 2, threadFix: {} }));
  await Promise.resolve();
  h.flush();
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(h.state.pending()).toBe(1);
  worker.reply(2);
  h.flush();
  await waiting;
  expect(ready).toBe(true);
});

it("keeps equal request IDs on separate workers distinct, including worker failure", async () => {
  const h = harness();
  const first = h.worker();
  const second = h.worker();
  first.postMessage({ id: 1, threadFix: {} });
  second.postMessage({ id: 1, threadFix: {} });
  expect(h.state.pending()).toBe(2);
  const waiting = h.state.whenSettled();
  first.reply(1);
  h.flush();
  expect(h.state.pending()).toBe(1);
  second.dispatchEvent(new Event("error"));
  h.flush();
  await waiting;
  expect(h.state.pending()).toBe(0);
});

it("propagates a post failure and does not strand readiness", async () => {
  const h = harness();
  const worker = h.worker();
  worker.failure = new Error("post failed");
  expect(() => worker.postMessage({ id: 1, threadFix: {} })).toThrow(worker.failure);
  const waiting = h.state.whenSettled();
  h.flush();
  await waiting;
  expect(h.state.pending()).toBe(0);
});

it("can hold the first request for the browser regression and releases it only once", async () => {
  const h = harness(true);
  const worker = h.worker();
  worker.postMessage({ id: 1, threadFix: {} });
  expect(worker.sent).toHaveLength(0);
  expect(h.state.pending()).toBe(1);
  const release = h.state.release;
  release?.();
  release?.();
  expect(worker.sent).toHaveLength(1);
  const waiting = h.state.whenSettled();
  worker.reply(1);
  h.flush();
  await waiting;
});
