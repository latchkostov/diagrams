import { afterEach, describe, expect, it, vi } from "vitest";
import { notify, toast } from "./toast";
import { HistoryController } from "../../editor/historyController";
import { canUndo, present } from "../../editor/history";
import { toFlow } from "../../canvas/convert";

function editorHistory() {
  const snapshot = (title: string) => toFlow({ format: "diagrams/v1", title, nodes: [], edges: [] });
  const history = new HistoryController(snapshot("Initial"), 0);
  const current = () => (canUndo(history.history) ? history.undoEntryId() : undefined);
  const unbind = toast.bindHistory({ capture: current, current });
  return {
    history,
    unbind,
    edit: (title: string) =>
      history.replace(
        present(history.history).value,
        undefined,
        snapshot(title),
        "same-tag",
        { nodes: [], edges: [] },
        0,
      ),
    undo: () => history.step("undo", { nodes: [], edges: [] }),
    redo: () => history.step("redo", { nodes: [], edges: [] }),
    title: () => present(history.history).value.meta.title,
  };
}

afterEach(() => {
  toast.release();
  while (toast.current) toast.dismiss(toast.current.id);
});

describe("an engaged toast keeps its action", () => {
  it("releases resources once, only when the toast is no longer retained or waiting", () => {
    const onDismiss = vi.fn();
    const first = notify("First", { onDismiss });
    toast.contact("focus", true);
    const next = toast.info("Next");
    expect(onDismiss).not.toHaveBeenCalled();
    toast.dismiss(first);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    toast.dismiss(first);
    toast.dismiss(next);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  for (const contact of ["pointer", "focus", "press"] as const) {
    it(`defers new arrivals during ${contact}, then publishes only the latest`, () => {
      const first = toast.info("First");
      toast.contact(contact, true);
      toast.info("Second");
      const last = toast.info("Third");
      expect(toast.current?.id).toBe(first);
      toast.contact(contact, false);
      expect(toast.current?.id).toBe(last);
    });
  }

  it("keeps a press engaged after the pointer leaves and until focus also leaves", () => {
    const first = toast.info("First");
    toast.contact("pointer", true);
    toast.contact("press", true);
    toast.contact("focus", true);
    const next = toast.info("Next");
    toast.contact("pointer", false);
    toast.contact("press", false);
    expect(toast.current?.id).toBe(first);
    toast.contact("focus", false);
    expect(toast.current?.id).toBe(next);
  });

  it("dismisses the acted-on toast without losing its waiting notification", () => {
    const first = toast.info("First");
    toast.contact("pointer", true);
    const next = toast.info("Next");
    toast.dismiss(first);
    expect(toast.engaged).toBe(false);
    expect(toast.current?.id).toBe(next);
  });

  it("invalidates an engaged Undo immediately when history changes", () => {
    toast.info("Undo", { action: { label: "Undo", run() {}, undoes: true } });
    toast.contact("focus", true);
    const next = toast.info("Next");
    toast.dismissUndo();
    expect(toast.current?.id).toBe(next);
    expect(toast.engaged).toBe(false);
  });

  for (const blocking of [false, true]) {
    it(`keeps a task's progress current while engaged (blocking: ${blocking})`, () => {
      const task = toast.busy("Exporting", { blocking });
      toast.contact("focus", true);
      const next = toast.info("Next");
      toast.progress(task, 0.5);
      expect(toast.current).toMatchObject({ id: task, progress: 0.5 });
      toast.dismiss(task);
      expect(toast.current?.id).toBe(next);
      expect(toast.engaged).toBe(false);
    });
  }
});

describe("history-bound Undo", () => {
  it("keeps the same entry ID when autosave assigns a copy name", () => {
    const h = editorHistory();
    try {
      h.edit("A");
      const id = toast.info("Applied A", { action: { label: "Undo", run: h.undo, undoes: true } });
      h.history.renameTitle("A", "A copy");
      toast.invalidateUndo();
      expect(toast.canRunAction(id)).toBe(true);
      toast.current!.action!.run();
      expect(h.title()).toBe("Initial");
    } finally {
      h.unbind();
    }
  });
  for (const contact of ["pointer", "focus"] as const) {
    it(`cannot undo B from retained A during ${contact}, even before invalidation renders`, () => {
      const h = editorHistory();
      try {
        h.edit("A");
        const id = toast.success("Applied A", { action: { label: "Undo", run: h.undo, undoes: true } });
        const action = toast.current!.action!;
        const entryId = toast.current!.undoEntryId;
        toast.contact(contact, true);
        h.edit("B");
        toast.success("Applied B", { action: { label: "Undo", run: h.undo, undoes: true } });
        expect(toast.current?.id).toBe(id);
        action.run();
        expect(h.title()).toBe("B");
        expect(toast.current).toMatchObject({ id, undoEntryId: entryId, undoUnavailable: true });
        expect(toast.canRunAction(id)).toBe(false);
        toast.contact(contact, false);
        expect(toast.current?.text).toBe("Applied B");
        toast.current!.action!.run();
        expect(h.title()).toBe("A");
      } finally {
        h.unbind();
      }
    });
  }

  for (const movement of ["undo", "redo", "branch", "edit"] as const) {
    it(`invalidates after external ${movement} without reviving the old action`, () => {
      const h = editorHistory();
      try {
        h.edit("A");
        const id = toast.info("Applied A", { action: { label: "Undo", run: h.undo, undoes: true } });
        const action = toast.current!.action!;
        toast.contact("focus", true);
        if (movement === "edit") h.edit("B");
        else {
          h.undo();
          if (movement === "branch") h.edit("A");
          else if (movement === "redo") {
            toast.invalidateUndo();
            h.redo();
          }
        }
        const before = h.title();
        toast.invalidateUndo();
        action.run();
        expect(h.title()).toBe(before);
        expect(toast.canRunAction(id)).toBe(false);
      } finally {
        h.unbind();
      }
    });
  }
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
