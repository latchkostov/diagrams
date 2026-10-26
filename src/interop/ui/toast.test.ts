import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY_PENDING, notify, toast } from "./toast";
import { modalLayers, openModalLayer } from "../../lib/modalLayers";
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
  it("preempts a retained notification without changing it or transferring its engagement", () => {
    const first = toast.info("Undo", { action: { label: "Undo", run() {} } });
    toast.contact("focus", true);
    const retained = toast.current;
    const task = toast.busy("Exporting", { blocking: true });
    expect(toast.current?.id).toBe(task);
    expect(toast.retained).toBe(retained);
    toast.contact("focus", true, task);
    toast.progress(task, 0.5);
    expect(toast.current).toMatchObject({ id: task, progress: 0.5 });
    expect(toast.retained).toBe(retained);
    toast.dismiss(task);
    expect(toast.current?.id).toBe(first);
    expect(toast.retained).toBeNull();
  });

  it("resolves history identity once even when held and deferred are the same Undo", () => {
    const entry = {};
    const current = vi.fn(() => entry);
    const unbind = toast.bindHistory({ capture: () => entry, current });
    try {
      toast.info("Undo", { action: { label: "Undo", run() {}, undoes: true } });
      toast.contact("focus", true);
      toast.invalidateUndo();
      expect(current).toHaveBeenCalledTimes(1);
    } finally {
      unbind();
    }
  });

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

describe("layers: a dialog's feedback, and the page's notifications behind it", () => {
  const el = () => ({}) as HTMLElement;
  const closers: (() => void)[] = [];
  const open = (feedback: HTMLElement | null = el()) => {
    const close = openModalLayer(el(), { feedback });
    closers.push(close);
    return close;
  };
  afterEach(() => {
    while (closers.length) closers.pop()!();
    toast.dismiss();
  });

  it("shows feedback in the topmost dialog and leaves the engaged page notification where it was", () => {
    const page = toast.info("Agent change", { action: { label: "Undo", run: () => {} } });
    toast.contact("focus", true);
    open();
    expect(toast.steppedBack).toBe(true);
    const copied = toast.success("Copied");
    expect(toast.current?.id).toBe(page);
    expect(toast.layered.map((l) => l.toast.id)).toEqual([copied]);
    expect(toast.layered[0].layer).toBe(modalLayers.top);
  });

  it("is the page's when no dialog is open, or the top modal has no feedback slot (it then waits)", () => {
    const plain = toast.success("No dialog");
    expect(toast.current?.id).toBe(plain);
    open(null);
    const palette = toast.success("Palette");
    expect(toast.current?.id).toBe(palette);
    expect(toast.layered).toEqual([]);
  });

  it("returns to the page if it outlives its dialog: latest wins there, and the one it replaces is released once", () => {
    const released = vi.fn();
    notify("Behind", { onDismiss: released });
    const close = open();
    const copied = notify("Couldn't copy", { kind: "error", onDismiss: released });
    close();
    expect(toast.layered).toEqual([]);
    expect(toast.steppedBack).toBe(false);
    expect(toast.current).toMatchObject({ id: copied, layer: undefined });
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("returns behind an engaged page notification, which keeps its place", () => {
    const page = toast.info("Agent change", { action: { label: "Undo", run: () => {} } });
    toast.contact("press", true);
    const close = open();
    const later = toast.info("Agent change B");
    close();
    expect(toast.current?.id).toBe(page);
    toast.contact("press", false);
    expect(toast.current?.id).toBe(later);
  });

  it("keeps the layered snapshot while nothing in the layers changes", () => {
    open();
    toast.success("Copied");
    const before = toast.layered;
    toast.invalidateUndo();
    expect(toast.layered).toBe(before);
    toast.info("Agent change");
    expect(toast.layered).not.toBe(before);
  });

  for (const contact of ["pointer", "focus", "press"] as const) {
    it(`holds engaged feedback during ${contact}; the latest waits, then follows the release`, () => {
      open();
      const first = toast.success("First copy");
      toast.contact(contact, true, first);
      expect(toast.engagedFor(first)).toBe(true);
      expect(toast.engaged).toBe(false);
      toast.success("Second copy");
      const last = toast.success("Third copy");
      expect(toast.layered.map((l) => l.toast.id)).toEqual([first]);
      if (contact === "press") toast.endPress();
      else toast.contact(contact, false, first);
      expect(toast.layered.map((l) => l.toast.id)).toEqual([last]);
    });
  }

  it("dismissing engaged feedback shows the one waiting; a page dismissal of all clears the layer too", () => {
    open();
    const first = toast.success("First");
    toast.contact("focus", true, first);
    const second = toast.success("Second");
    toast.dismiss(first);
    expect(toast.layered.map((l) => l.toast.id)).toEqual([second]);
    expect(toast.engagedFor(second)).toBe(false);
    toast.dismiss();
    expect(toast.layered).toEqual([]);
  });

  it("feedback in an inner dialog belongs to it; the outer dialog keeps its own", () => {
    const outer = open();
    const a = toast.success("Outer");
    const inner = open();
    const b = toast.success("Inner");
    expect(toast.layered.map((l) => l.toast.id)).toEqual([a, b]);
    inner();
    expect(toast.layered.map((l) => l.toast.id)).toEqual([a]);
    outer();
    expect(toast.layered).toEqual([]);
  });
});

describe("an Undo while its edit is still being recorded", () => {
  for (const merged of [true, false]) {
    it(`waits while pending, then ${merged ? "stays available when the edit merged" : "goes stale when it made a new entry"}`, () => {
      const entry = {};
      const later = {};
      let state: object | typeof HISTORY_PENDING = entry;
      const run = vi.fn();
      const unbind = toast.bindHistory({
        capture: () => (state === HISTORY_PENDING ? (merged ? entry : later) : state),
        current: () => state,
      });
      try {
        const id = toast.info("Moved the text off an edge", { action: { label: "Undo", run, undoes: true } });
        state = HISTORY_PENDING;
        toast.invalidateUndo();
        expect(toast.current).toMatchObject({ id, undoUnavailable: false });
        expect(toast.canRunAction(id)).toBe(merged);
        toast.current!.action!.run();
        expect(run).toHaveBeenCalledTimes(merged ? 1 : 0);
      } finally {
        unbind();
      }
    });
  }
});
