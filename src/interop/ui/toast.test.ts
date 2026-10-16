import { afterEach, describe, expect, it } from "vitest";
import { toast } from "./toast";

afterEach(() => {
  while (toast.current) toast.dismiss(toast.current.id);
});

describe("a task's Cancel owns its toast", () => {
  it("keeps Cancel and progress visible until its owner finishes, then shows the latest notification", () => {
    const task = toast.busy("Exporting", { blocking: true });
    toast.info("Earlier notification");
    const latest = toast.success("Saved");
    expect(toast.current?.id).toBe(task);
    toast.progress(task, 0.5);
    expect(toast.current?.progress).toBe(0.5);
    const snapshot = toast.current;
    toast.progress(task, 0.5);
    expect(toast.current).toBe(snapshot);
    toast.dismiss(task);
    expect(toast.current?.id).toBe(latest);
  });

  it("handles overlapping owners and out-of-order completion without losing Cancel", () => {
    const older = toast.busy("Older", { blocking: true });
    const newer = toast.busy("Newer", { blocking: true });
    toast.progress(older, 0.25);
    toast.dismiss(newer);
    expect(toast.current).toMatchObject({ id: older, progress: 0.25 });
    const newest = toast.busy("Newest", { blocking: true });
    toast.dismiss(older);
    expect(toast.current?.id).toBe(newest);
    toast.dismiss(newest);
    expect(toast.current).toBeNull();
  });

  it("generic dismissal and invalidated Undo clear waiting messages without discarding Cancel", () => {
    const task = toast.busy("Exporting", { blocking: true });
    toast.info("Undo", { action: { label: "Undo", run() {}, undoes: true } });
    toast.dismissUndo();
    toast.info("Another message");
    toast.dismiss();
    expect(toast.current?.id).toBe(task);
    toast.dismiss(task);
    expect(toast.current).toBeNull();
  });
});
