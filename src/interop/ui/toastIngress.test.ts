import { afterEach, expect, it, vi } from "vitest";

// Hold the renderer independently of the synchronous ingress, as the browser's chunk tests do.
vi.mock("./Toaster", () => ({ Toaster: () => null }));
afterEach(() => vi.resetModules());

it("captures Undo before download and replays later invalidation without rebinding it", async () => {
  const { toast } = await import("./toast");
  const first = {};
  let entry = first;
  const undo = vi.fn();
  toast.bindHistory({ capture: () => entry, current: () => entry });
  const id = toast.info("First", { action: { label: "Undo", run: undo, undoes: true } });
  entry = {};
  toast.invalidateUndo();
  const { toast: interaction } = await import("./toastRuntime");
  expect(interaction.current?.undoEntryId).toBe(first);
  expect(interaction.current?.undoUnavailable).toBe(true);
  expect(interaction.canRunAction(id)).toBe(false);
  interaction.current?.action?.run();
  expect(undo).not.toHaveBeenCalled();
  toast.dismiss();
  expect(interaction.current).toBeNull();
});

it("replays task progress, cancellation and cleanup in arrival order", async () => {
  const { toast, notify } = await import("./toast");
  const dismissed = vi.fn();
  notify("First", { onDismiss: dismissed });
  const task = toast.busy("Export", { blocking: true });
  toast.progress(task, 0.5);
  toast.info("Waiting");
  const { toast: interaction } = await import("./toastRuntime");
  expect(interaction.current).toMatchObject({ id: task, progress: 0.5, blocking: true });
  expect(dismissed).toHaveBeenCalledTimes(1);
  toast.dismiss(task);
  expect(interaction.current?.text).toBe("Waiting");
  toast.dismiss();
});

it("keeps feedback raised before download in its dialog, or on the page after it closes", async () => {
  const { toast } = await import("./toast");
  const { openModalLayer } = await import("../../lib/modalLayers");
  const close = openModalLayer({} as HTMLElement, { feedback: {} as HTMLElement });
  const id = toast.success("Copied");
  const { toast: interaction } = await import("./toastRuntime");
  expect(interaction.layered[0].toast.id).toBe(id);
  close();
  expect(interaction.current?.id).toBe(id);
  toast.dismiss();
});

it("gives an action found before download to its notification, and none to one already gone", async () => {
  const { toast } = await import("./toast");
  const gone = toast.success("Replaced");
  toast.dismiss(gone);
  const id = toast.success("Private");
  const clear = { label: "Clear conversation", run: vi.fn() };
  toast.attach(gone, clear);
  toast.attach(id, clear);
  const { toast: interaction } = await import("./toastRuntime");
  expect(interaction.current).toMatchObject({ id, action: clear, duration: 6000 });
  toast.dismiss();
});

it("keeps what waits for the renderer compact: invalidation runs and progress, replayed with the same effect", async () => {
  const { toast, installToastRuntime, HISTORY_PENDING } = await import("./toast");
  const bound = {};
  let entry: object | typeof HISTORY_PENDING = bound;
  toast.bindHistory({ capture: () => bound, current: () => entry });
  const id = toast.info("Moved", { action: { label: "Undo", run() {}, undoes: true } });
  const task = toast.busy("Export", { blocking: true });
  // A long wait: a drag's every snapshot (pending, then recorded as the same step) and a task's every report.
  for (let i = 1; i <= 1000; i++) {
    entry = i % 2 ? HISTORY_PENDING : bound;
    toast.invalidateUndo();
    toast.progress(task, i / 1000);
  }
  entry = {};
  toast.invalidateUndo();
  const later = toast.info("Later");
  entry = bound;
  toast.invalidateUndo();
  const runtime = { show: vi.fn(), invalidateUndo: vi.fn(), progress: vi.fn() };
  installToastRuntime(runtime as unknown as Parameters<typeof installToastRuntime>[0]);
  expect(runtime.show.mock.calls.map(([input]) => input.id)).toEqual([id, task, later]);
  expect(runtime.progress.mock.calls).toEqual([[task, 1]]);
  // The run saw two different entries: nothing bound to either still stands, as with a fresh one.
  expect(runtime.invalidateUndo).toHaveBeenCalledTimes(2);
  const [[run], [after]] = runtime.invalidateUndo.mock.calls;
  expect(run).not.toBe(bound);
  expect(run).toBeTypeOf("object");
  expect(after).toBe(bound);
});
