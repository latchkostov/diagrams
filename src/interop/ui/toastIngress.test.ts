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
  expect(toast.currentId).toBe(id);
  entry = {};
  toast.invalidateUndo();
  const { toast: interaction } = await import("./toastRuntime");
  expect(interaction.current?.undoEntryId).toBe(first);
  expect(interaction.current?.undoUnavailable).toBe(true);
  expect(interaction.canRunAction(id)).toBe(false);
  interaction.current?.action?.run();
  expect(undo).not.toHaveBeenCalled();
  toast.dismiss();
  expect(toast.currentId).toBeUndefined();
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
