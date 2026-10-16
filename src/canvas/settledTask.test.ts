import { expect, it, vi } from "vitest";
import { settledTask } from "./settledTask";

function setup() {
  let sample: string | null = null;
  const frames = new Set<() => void>();
  const pending = vi.fn();
  const queue = settledTask(
    () => sample,
    (f) => {
      frames.add(f);
      return () => frames.delete(f);
    },
    pending,
  );
  const frame = () => {
    const next = [...frames];
    frames.clear();
    next.forEach((f) => f());
  };
  return {
    queue,
    frame,
    frames,
    pending,
    measure: (s: string | null) => {
      sample = s;
      queue.wake();
    },
  };
}

it("waits for delivered measurements, then a stable rendered sample; it never falls back after N frames", () => {
  const t = setup();
  const run = vi.fn();
  t.queue.request(run);
  for (let i = 0; i < 100; i++) {
    t.queue.wake();
    t.frame();
  }
  expect(run).not.toHaveBeenCalled();
  t.measure("cards measured, old boundary");
  t.frame();
  t.measure("cards measured, new boundary, old chrome");
  t.frame();
  t.measure("cards measured, new boundary, measured chrome");
  t.frame();
  expect(run).not.toHaveBeenCalled();
  t.frame();
  expect(run).toHaveBeenCalledOnce();
});

it("keeps a newer request pending when a task queues the post-layout fit, including its animation", async () => {
  const t = setup();
  let finish!: () => void;
  const fit = vi.fn(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  t.queue.request(() => t.queue.request(fit));
  t.measure("before layout");
  t.frame();
  t.frame();
  await Promise.resolve();
  expect(t.pending).not.toHaveBeenLastCalledWith(false);
  t.measure("after layout");
  t.frame();
  t.frame();
  expect(fit).toHaveBeenCalledOnce();
  expect(t.pending).not.toHaveBeenLastCalledWith(false);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(t.pending).toHaveBeenLastCalledWith(false);
});

it("replaces stale requests and cancels work on unmount", () => {
  const t = setup();
  const stale = vi.fn();
  const fresh = vi.fn();
  t.queue.request(stale);
  t.queue.request(fresh);
  t.measure("ready");
  t.frame();
  t.frame();
  expect(stale).not.toHaveBeenCalled();
  expect(fresh).toHaveBeenCalledOnce();
  t.queue.request(stale);
  t.queue.dispose();
  t.frame();
  expect(stale).not.toHaveBeenCalled();
  expect(t.frames.size).toBe(0);
});

it("preserves ordered document commands across coalesced fits and nested requests", async () => {
  const t = setup();
  const ran: string[] = [];
  const stale = vi.fn();
  t.queue.whenReady(() => {
    ran.push("layout one");
    t.queue.request(stale);
    t.queue.whenReady(() => {
      ran.push("nested command");
      t.queue.request(() => ran.push("final fit"));
    });
  });
  t.queue.request(stale);
  t.queue.whenReady(() => ran.push("layout two"));
  t.queue.request(() => ran.push("superseded fit"));
  t.measure("ready");
  for (let i = 0; i < 4; i++) {
    t.frame();
    t.frame();
    if (i < 3) expect(t.pending).not.toHaveBeenLastCalledWith(false);
    await Promise.resolve();
  }
  expect(ran).toEqual(["layout one", "layout two", "nested command", "final fit"]);
  expect(stale).not.toHaveBeenCalled();
  expect(t.pending).toHaveBeenLastCalledWith(false);
  t.queue.whenReady(stale);
  t.queue.dispose();
  t.frame();
  expect(stale).not.toHaveBeenCalled();
});

it("runs document commands and their final fit even if an interrupted viewport animation never resolves", async () => {
  const t = setup();
  t.queue.request(() => new Promise(() => {}));
  t.measure("ready");
  t.frame();
  t.frame();
  const layout = vi.fn(() => t.queue.request(fit));
  const fit = vi.fn();
  t.queue.whenReady(layout);
  t.frame();
  t.frame();
  await Promise.resolve();
  expect(layout).toHaveBeenCalledOnce();
  expect(t.pending).not.toHaveBeenLastCalledWith(false);
  t.frame();
  t.frame();
  await Promise.resolve();
  expect(fit).toHaveBeenCalledOnce();
  expect(t.pending).toHaveBeenLastCalledWith(false);
});

it("settles an interrupted final viewport transition without another request", async () => {
  const t = setup();
  let finish!: () => void;
  t.queue.request(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  t.measure("ready");
  t.frame();
  t.frame();
  expect(t.pending).toHaveBeenLastCalledWith(true);
  t.queue.interrupt();
  expect(t.pending).toHaveBeenLastCalledWith(false);
  expect(t.frames.size).toBe(0);
  // A superseded promise completing later must not settle the new transition.
  t.queue.request(() => new Promise(() => {}));
  t.frame();
  t.frame();
  finish();
  await Promise.resolve();
  expect(t.pending).toHaveBeenLastCalledWith(true);
});

it("interrupts viewport work while preserving measurement subscribers and their cancellation", async () => {
  const t = setup();
  const layout = vi.fn();
  const cancelled = vi.fn();
  t.queue.request(() => new Promise(() => {}));
  t.measure("ready");
  t.frame();
  t.frame();
  t.measure(null);
  t.queue.whenReady(layout);
  const unsubscribe = t.queue.whenReady(cancelled);
  t.queue.request(vi.fn());
  t.queue.interrupt();
  unsubscribe();
  expect(t.pending).toHaveBeenLastCalledWith(true);
  t.measure("ready again");
  t.frame();
  t.frame();
  await Promise.resolve();
  expect(layout).toHaveBeenCalledOnce();
  expect(cancelled).not.toHaveBeenCalled();
  expect(t.pending).toHaveBeenLastCalledWith(false);
});

it("unsubscribes between stable samples without running a stale frame", () => {
  const t = setup();
  const run = vi.fn();
  const unsubscribe = t.queue.whenReady(run);
  t.measure("ready");
  t.frame();
  unsubscribe();
  expect(t.frames.size).toBe(0);
  t.frame();
  expect(run).not.toHaveBeenCalled();
  expect(t.pending).toHaveBeenLastCalledWith(false);
});
