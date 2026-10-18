import type { CDPSession, Page } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import { startTransient, switchTraffic } from "../../tests/bench/ui/liveCapture";
import { LIVE_SETTLE_FRAMES, slowPhase, steadyTail } from "./liveMetrics";

afterEach(() => vi.unstubAllGlobals());

it("keeps an unstable capture unsettled when its recording cap is reached", async () => {
  const gaps = [...Array(8).fill(1_000), ...Array.from({ length: 16 }, () => [5_000, 1_000, 1_000]).flat()];
  const frames = [0];
  for (const gap of gaps) frames.push(frames[frames.length - 1] + gap);
  vi.stubGlobal("window", { __liveCapture: { frames, stop: () => ({ frames, peakTransitions: 7 }) } });
  const page = {
    // Installation is covered by the traffic-path tests; here the page already holds a completed recording.
    evaluate: async (fn: () => unknown, arg?: unknown) => (arg ? undefined : fn()),
    waitForFunction: vi.fn(),
  } as unknown as Page;
  const cdp = { on: vi.fn(), off: vi.fn(), send: vi.fn(async () => {}) } as unknown as CDPSession;
  const capture = await startTransient({ page, cdp }, false, 120_000);
  expect(await capture.collect()).toMatchObject({ slowPhaseMs: 120_000, settled: false, peakTransitions: 7 });
  expect(page.waitForFunction).not.toHaveBeenCalled();
  expect(cdp.off).toHaveBeenCalledOnce();
});

it("keeps collecting recurring stalls at every polling boundary until the recording cap", async () => {
  const gaps = [...Array(8).fill(1_000), ...Array.from({ length: 16 }, () => [5_000, 1_000, 1_000]).flat()];
  const trace = [0];
  for (const gap of gaps) trace.push(trace[trace.length - 1] + gap);
  const frames = trace.slice(0, LIVE_SETTLE_FRAMES + 1);
  vi.stubGlobal("window", { __liveCapture: { frames, stop: () => ({ frames, peakTransitions: 0 }) } });
  const polls: number[] = [];
  const page = {
    evaluate: async (fn: () => unknown, arg?: unknown) => (arg ? undefined : fn()),
    waitForFunction: async (fn: (arg: unknown) => boolean, arg: unknown) => {
      frames.push(...trace.slice(frames.length, frames.length + LIVE_SETTLE_FRAMES));
      polls.push(frames.at(-1)!);
      expect(fn(arg)).toBe(true);
    },
  } as unknown as Page;
  const cdp = { on: vi.fn(), off: vi.fn(), send: vi.fn(async () => {}) } as unknown as CDPSession;
  const capture = await startTransient({ page, cdp }, false, 120_000);
  expect(await capture.collect()).toMatchObject({ slowPhaseMs: 120_000, settled: false });
  expect(polls[0]).toBe(28_000);
  expect(frames).toEqual(trace);
  expect(cdp.off).toHaveBeenCalledOnce();
});

it.each([false, true])("records the initial x10 stall, including panel closure (panel=%s)", async (panel) => {
  await recordTraffic(panel);
});

it("captures transition peaks when panel closure exceeds the recording cap", async () => {
  await recordTraffic(true, true);
});

async function recordTraffic(panel: boolean, closesAfterCap = false) {
  let now = 10_000;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let keydown: (() => void) | undefined;
  let changed = false;
  let animations: unknown[] = [];
  class Transition {
    playState = "running";
  }
  vi.stubGlobal("CSSTransition", Transition);
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal("document", {
    getAnimations: () => animations,
    querySelector: () => ({
      addEventListener: (_event: string, callback: () => void) => {
        keydown = callback;
      },
      getAttribute: () => (changed ? "10" : "1"),
    }),
  });
  const frame = (gap: number) => {
    now += gap;
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(now);
  };
  const mutate = () => {
    changed = true;
    animations = [new Transition(), new Transition()];
    frame(6_000); // The mutation stalls the main thread before its first frame.
  };
  vi.stubGlobal("window", { __liveBench: { timesTen: mutate } });
  let releaseClose = () => {};
  let signalClose = () => {};
  const closing = new Promise<void>((resolve) => {
    signalClose = resolve;
  });
  const close = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  const page = {
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
    waitForFunction: async (fn: () => boolean) => {
      expect(fn()).toBe(true);
    },
    keyboard: {
      press: async () => {
        keydown?.();
        mutate();
      },
    },
    getByTestId: (id: string) => ({
      click: async () => {
        if (id === "capacity-close") {
          signalClose();
          await close;
        }
      },
      waitFor: async () => {},
      getAttribute: async () => "1",
      selectOption: async () => {},
      focus: async () => {},
    }),
  } as unknown as Page;
  let layers: (event: { layers: unknown[] }) => void = () => {};
  const cdp = {
    on: (_event: string, callback: typeof layers) => {
      layers = callback;
    },
    off: vi.fn(),
    send: vi.fn(async () => {}),
  } as unknown as CDPSession;
  let capture: Awaited<ReturnType<typeof startTransient>> | undefined;
  const switching = switchTraffic(
    page,
    panel,
    async () => {
      capture = await startTransient({ page, cdp }, panel, 120_000);
    },
    60_000,
  );
  if (panel) {
    // Drain only promise continuations, while the close operation remains blocked.
    await closing;
    expect(window.__liveCapture.frames).toEqual([10_000, 16_000]);
    if (closesAfterCap) frame(120_000);
    const capped = [...window.__liveCapture.frames];
    animations = Array.from({ length: closesAfterCap ? 100 : 5 }, () => new Transition());
    frame(100);
    if (closesAfterCap) expect(window.__liveCapture.frames).toEqual(capped);
    layers({ layers: Array(9).fill({}) });
    releaseClose();
  }
  await switching;
  animations = [];
  for (let i = 0; i < 120; i++) frame(100);
  const recording = window.__liveCapture.stop();
  expect(recording.frames[0]).toBe(10_000);
  expect(recording.peakTransitions).toBe(closesAfterCap ? 100 : panel ? 5 : 2);
  const tail = steadyTail(recording.frames);
  expect(tail.stable).toBe(!closesAfterCap);
  const slowPhaseMs = closesAfterCap ? 126_000 : 6_000;
  expect(slowPhase(recording.frames, tail)).toMatchObject({ slowPhaseMs, settled: !closesAfterCap });
  expect(await capture?.collect()).toMatchObject({
    slowPhaseMs,
    settled: !closesAfterCap,
    peakLayers: panel ? 9 : 0,
    peakTransitions: closesAfterCap ? 100 : panel ? 5 : 2,
  });
  expect(cdp.off).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(0);
}
