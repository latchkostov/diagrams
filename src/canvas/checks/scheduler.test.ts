import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../../checks/types";
import type { DiagramFile } from "../../model/types";
import { createCheckScheduler, type IdleApi } from "./scheduler";
import { CheckRuns, ChecksStore, FIRST_RUN_DELAY, NOTHING_TO_CHECK, summarizeResult } from "./useChecks";

// When the checks run: after edits pause, in idle time, one at a time with only the newest queued.

/** An idle queue the test flushes by hand. */
function fakeIdle() {
  const queue = new Map<number, () => void>();
  let seq = 0;
  const api: IdleApi = {
    request: (fn) => {
      queue.set(++seq, fn);
      return seq;
    },
    cancel: (id) => void queue.delete(id),
  };
  const flush = () => {
    const fns = [...queue.values()];
    queue.clear();
    fns.forEach((fn) => fn());
  };
  return { api, flush, size: () => queue.size };
}

/** A run the test resolves by hand. */
function deferredRuns() {
  const resolvers: (() => void)[] = [];
  const run = vi.fn(() => new Promise<void>((r) => resolvers.push(r)));
  const finish = async () => {
    resolvers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { run, finish };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createCheckScheduler", () => {
  it("debounces: a burst of changes runs once, after the quiet time and in idle time", () => {
    const idle = fakeIdle();
    const { run } = deferredRuns();
    const s = createCheckScheduler(run, { delayMs: 400, idle: idle.api });
    for (let i = 0; i < 20; i++) {
      s.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(idle.size()).toBe(0);
    vi.advanceTimersByTime(300);
    expect(run).not.toHaveBeenCalled();
    expect(idle.size()).toBe(1);
    idle.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never overlaps: changes during a run queue exactly one more, with the newest", async () => {
    const idle = fakeIdle();
    const { run, finish } = deferredRuns();
    const s = createCheckScheduler(run, { delayMs: 10, idle: idle.api });
    s.schedule();
    vi.advanceTimersByTime(10);
    idle.flush();
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      s.schedule();
      vi.advanceTimersByTime(10);
      idle.flush();
    }
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.busy()).toBe(true);
    await finish();
    idle.flush();
    expect(run).toHaveBeenCalledTimes(2);
    await finish();
    idle.flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.busy()).toBe(false);
  });

  it("completion respects the latest debounce and cancellation", async () => {
    const idle = fakeIdle();
    const { run, finish } = deferredRuns();
    const s = createCheckScheduler(run, { delayMs: 400, idle: idle.api });
    s.schedule();
    vi.advanceTimersByTime(400);
    idle.flush();
    expect(run).toHaveBeenCalledTimes(1);
    // While it runs: a change whose debounce passes (queues a follow-up), then a newer one still debouncing.
    s.schedule();
    vi.advanceTimersByTime(400);
    idle.flush();
    s.schedule();
    vi.advanceTimersByTime(100);
    await finish();
    idle.flush();
    // No early follow-up: the newest edit's quiet time isn't over.
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    idle.flush();
    expect(run).toHaveBeenCalledTimes(2);
    await finish();
    // And after cancel(), nothing runs, however long it waits.
    s.schedule();
    vi.advanceTimersByTime(100);
    s.cancel();
    vi.advanceTimersByTime(5000);
    idle.flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.busy()).toBe(false);
  });

  it("now() skips the debounce; cancel() drops what's waiting", () => {
    const idle = fakeIdle();
    const { run } = deferredRuns();
    const s = createCheckScheduler(run, { delayMs: 400, idle: idle.api });
    s.schedule();
    s.now();
    idle.flush();
    expect(run).toHaveBeenCalledTimes(1);
    const s2 = createCheckScheduler(run, { delayMs: 400, idle: idle.api });
    s2.schedule();
    s2.cancel();
    vi.advanceTimersByTime(1000);
    idle.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a failed run doesn't stop the next one", async () => {
    const idle = fakeIdle();
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const s = createCheckScheduler(run, { delayMs: 0, idle: idle.api });
    s.schedule();
    vi.advanceTimersByTime(0);
    idle.flush();
    await Promise.resolve();
    await Promise.resolve();
    s.schedule();
    vi.advanceTimersByTime(0);
    idle.flush();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("CheckRuns", () => {
  const diagram = (n: number): DiagramFile => ({
    format: "diagrams/v1",
    title: "t",
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, stencil: "service.go", label: "N", x: 0, y: 0 })),
    edges: [],
  });
  const result = (title: string): CheckResult => ({ findings: [], ignored: [], off: [], ran: [title as never] });

  it("waits longer before the first run, reads the diagram at run time, and drops results after stop()", async () => {
    const idle = fakeIdle();
    const delivered: (CheckResult | null)[] = [];
    let resolve: (r: CheckResult) => void = () => {};
    const run = vi.fn(() => new Promise<CheckResult>((r) => (resolve = r)));
    const runs = new CheckRuns(
      (r) => delivered.push(r),
      run,
      (task) => createCheckScheduler(task, { delayMs: 400, idle: idle.api }),
    );
    let current = diagram(1);
    runs.setRead(() => current);
    runs.changed();
    vi.advanceTimersByTime(400);
    expect(idle.size()).toBe(0);
    vi.advanceTimersByTime(FIRST_RUN_DELAY - 400);
    current = diagram(3);
    idle.flush();
    expect(run).toHaveBeenCalledWith(current);
    resolve(result("dead-letter"));
    await vi.waitFor(() => expect(delivered).toHaveLength(1));
    // A run in flight when checks stop (live view, another diagram) never delivers.
    runs.changed();
    vi.advanceTimersByTime(400);
    idle.flush();
    runs.stop();
    resolve(result("capacity"));
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toHaveLength(1);
  });

  it("an empty diagram finishes with an empty result, not a run that never ends", async () => {
    const idle = fakeIdle();
    const delivered: (CheckResult | null)[] = [];
    const run = vi.fn();
    const runs = new CheckRuns(
      (r) => delivered.push(r),
      run,
      (task) => createCheckScheduler(task, { delayMs: 0, idle: idle.api }),
    );
    runs.setRead(() => diagram(0));
    runs.now();
    idle.flush();
    await vi.waitFor(() => expect(delivered).toEqual([NOTHING_TO_CHECK]));
    expect(run).not.toHaveBeenCalled();
    // The store tells "nothing found" from "still checking".
    const store = new ChecksStore();
    expect(store.get().result).toBeNull();
    store.set(NOTHING_TO_CHECK);
    expect(store.get().result).toEqual(NOTHING_TO_CHECK);
  });
});

describe("summarizeResult", () => {
  it("counts warnings and indexes findings by the elements they name", () => {
    const f = (id: string, severity: "warning" | "suggestion", elements: string[]) =>
      ({ id, severity, elements }) as unknown as CheckResult["findings"][number];
    const s = summarizeResult({
      findings: [f("a", "warning", ["q", "w", "q"]), f("b", "suggestion", ["q"])],
      ignored: [],
      off: [],
      ran: [],
    });
    expect(s.warnings).toBe(1);
    expect(s.byElement.get("q")?.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.byElement.get("w")?.map((x) => x.id)).toEqual(["a"]);
    expect(summarizeResult(null)).toMatchObject({ result: null, warnings: 0 });
  });
});

describe("ChecksStore", () => {
  const result = (ids: string[]): CheckResult => ({
    findings: ids.map(
      (id) => ({ id, severity: "warning", elements: [id] }) as unknown as CheckResult["findings"][number],
    ),
    ignored: [],
    off: [],
    ran: [],
  });

  it("notifies only when the result changes, so an unchanged check re-renders nothing", () => {
    const store = new ChecksStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(result(["a"]));
    store.set(result(["a"]));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get().warnings).toBe(1);
    store.set(result([]));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("shows nothing while checks are off, and tracks the hovered finding", () => {
    const store = new ChecksStore();
    store.set(result(["a", "b"]));
    store.setEnabled(false);
    expect(store.get()).toMatchObject({ result: null, warnings: 0 });
    store.setEnabled(true);
    expect(store.get().warnings).toBe(2);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setHot("a");
    store.setHot("a");
    expect(store.getHot()).toBe("a");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("ChecksStore staleness", () => {
  it("an edit (or an applied fix) marks the findings stale until the next result, which clears it", () => {
    const store = new ChecksStore();
    const r: CheckResult = { findings: [], ignored: [], off: [], ran: ["capacity"] };
    store.markStale();
    expect(store.get().stale).toBe(false); // nothing shown yet: nothing to be stale
    store.set(r);
    store.markStale();
    expect(store.get().stale).toBe(true);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(r); // the same findings again: still delivered, to end the stale spell
    expect(store.get().stale).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("names elements from one index of the checked diagram", () => {
    const store = new ChecksStore();
    store.set(
      { findings: [], ignored: [], off: [], ran: [] },
      {
        format: "diagrams/v1",
        title: "t",
        nodes: [
          { id: "a", stencil: "service.go", label: "Orders", x: 0, y: 0 },
          { id: "b", stencil: "service.go", label: " ", x: 0, y: 0 },
        ],
        edges: [{ id: "e", from: "a", to: "b" }],
      },
    );
    const { name } = store.get();
    expect([name("a"), name("b"), name("e"), name("gone")]).toEqual(["Orders", "b", "Orders → b", undefined]);
  });
});
