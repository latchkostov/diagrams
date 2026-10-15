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
