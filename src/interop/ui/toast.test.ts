import { toast as interaction } from "./toastRuntime";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./toastRuntime";
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
  interaction.release();
  while (interaction.current) toast.dismiss(interaction.current.id);
});

describe("an engaged toast keeps its action", () => {
  it("releases resources once, only when the toast is no longer retained or waiting", () => {
    const onDismiss = vi.fn();
    const first = notify("First", { onDismiss });
    interaction.contact("focus", true);
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
      interaction.contact(contact, true);
      toast.info("Second");
      const last = toast.info("Third");
      expect(interaction.current?.id).toBe(first);
      interaction.contact(contact, false);
      expect(interaction.current?.id).toBe(last);
    });
  }

  it("keeps a press engaged after the pointer leaves and until focus also leaves", () => {
    const first = toast.info("First");
    interaction.contact("pointer", true);
    interaction.contact("press", true);
    interaction.contact("focus", true);
    const next = toast.info("Next");
    interaction.contact("pointer", false);
    interaction.contact("press", false);
    expect(interaction.current?.id).toBe(first);
    interaction.contact("focus", false);
    expect(interaction.current?.id).toBe(next);
  });

  it("dismisses the acted-on toast without losing its waiting notification", () => {
    const first = toast.info("First");
    interaction.contact("pointer", true);
    const next = toast.info("Next");
    toast.dismiss(first);
    expect(interaction.engaged).toBe(false);
    expect(interaction.current?.id).toBe(next);
  });

  it("invalidates an engaged Undo immediately when history changes", () => {
    toast.info("Undo", { action: { label: "Undo", run() {}, undoes: true } });
    interaction.contact("focus", true);
    const next = toast.info("Next");
    toast.dismissUndo();
    expect(interaction.current?.id).toBe(next);
    expect(interaction.engaged).toBe(false);
  });

  for (const blocking of [false, true]) {
    it(`keeps a task's progress current while engaged (blocking: ${blocking})`, () => {
      const task = toast.busy("Exporting", { blocking });
      interaction.contact("focus", true);
      const next = toast.info("Next");
      toast.progress(task, 0.5);
      expect(interaction.current).toMatchObject({ id: task, progress: 0.5 });
      toast.dismiss(task);
      expect(interaction.current?.id).toBe(next);
      expect(interaction.engaged).toBe(false);
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
      expect(interaction.canRunAction(id)).toBe(true);
      interaction.current!.action!.run();
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
        const action = interaction.current!.action!;
        const entryId = interaction.current!.undoEntryId;
        interaction.contact(contact, true);
        h.edit("B");
        toast.success("Applied B", { action: { label: "Undo", run: h.undo, undoes: true } });
        expect(interaction.current?.id).toBe(id);
        action.run();
        expect(h.title()).toBe("B");
        expect(interaction.current).toMatchObject({ id, undoEntryId: entryId, undoUnavailable: true });
        expect(interaction.canRunAction(id)).toBe(false);
        interaction.contact(contact, false);
        expect(interaction.current?.text).toBe("Applied B");
        interaction.current!.action!.run();
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
        const action = interaction.current!.action!;
        interaction.contact("focus", true);
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
        expect(interaction.canRunAction(id)).toBe(false);
      } finally {
        h.unbind();
      }
    });
  }
});

describe("a task's Cancel owns its toast", () => {
  it("preempts a retained notification without changing it or transferring its engagement", () => {
    const first = toast.info("Undo", { action: { label: "Undo", run() {} } });
    interaction.contact("focus", true);
    const retained = interaction.current;
    const task = toast.busy("Exporting", { blocking: true });
    expect(interaction.current?.id).toBe(task);
    expect(interaction.retained).toBe(retained);
    interaction.contact("focus", true, task);
    toast.progress(task, 0.5);
    expect(interaction.current).toMatchObject({ id: task, progress: 0.5 });
    expect(interaction.retained).toBe(retained);
    toast.dismiss(task);
    expect(interaction.current?.id).toBe(first);
    expect(interaction.retained).toBeNull();
  });

  it("resolves history identity once even when held and deferred are the same Undo", () => {
    const entry = {};
    const current = vi.fn(() => entry);
    const unbind = toast.bindHistory({ capture: () => entry, current });
    try {
      toast.info("Undo", { action: { label: "Undo", run() {}, undoes: true } });
      interaction.contact("focus", true);
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
    expect(interaction.current?.id).toBe(task);
    toast.progress(task, 0.5);
    expect(interaction.current?.progress).toBe(0.5);
    const snapshot = interaction.current;
    toast.progress(task, 0.5);
    expect(interaction.current).toBe(snapshot);
    toast.dismiss(task);
    expect(interaction.current?.id).toBe(latest);
  });

  it("handles overlapping owners and out-of-order completion without losing Cancel", () => {
    const older = toast.busy("Older", { blocking: true });
    const newer = toast.busy("Newer", { blocking: true });
    toast.progress(older, 0.25);
    toast.dismiss(newer);
    expect(interaction.current).toMatchObject({ id: older, progress: 0.25 });
    const newest = toast.busy("Newest", { blocking: true });
    toast.dismiss(older);
    expect(interaction.current?.id).toBe(newest);
    toast.dismiss(newest);
    expect(interaction.current).toBeNull();
  });

  it("generic dismissal and invalidated Undo clear waiting messages without discarding Cancel", () => {
    const task = toast.busy("Exporting", { blocking: true });
    toast.info("Undo", { action: { label: "Undo", run() {}, undoes: true } });
    toast.dismissUndo();
    toast.info("Another message");
    toast.dismiss();
    expect(interaction.current?.id).toBe(task);
    toast.dismiss(task);
    expect(interaction.current).toBeNull();
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
    interaction.contact("focus", true);
    open();
    expect(interaction.steppedBack).toBe(true);
    const copied = toast.success("Copied");
    expect(interaction.current?.id).toBe(page);
    expect(interaction.layered.map((l) => l.toast.id)).toEqual([copied]);
    expect(interaction.layered[0].layer).toBe(modalLayers.top);
  });

  it("is the page's when no dialog is open, or the top modal has no feedback slot (it then waits)", () => {
    const plain = toast.success("No dialog");
    expect(interaction.current?.id).toBe(plain);
    open(null);
    const palette = toast.success("Palette");
    expect(interaction.current?.id).toBe(palette);
    expect(interaction.layered).toEqual([]);
  });

  it("returns to the page if it outlives its dialog: latest wins there, and the one it replaces is released once", () => {
    const released = vi.fn();
    notify("Behind", { onDismiss: released });
    const close = open();
    const copied = notify("Couldn't copy", { kind: "error", onDismiss: released });
    close();
    expect(interaction.layered).toEqual([]);
    expect(interaction.steppedBack).toBe(false);
    expect(interaction.current).toMatchObject({ id: copied, layer: undefined });
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("returns behind an engaged page notification, which keeps its place", () => {
    const page = toast.info("Agent change", { action: { label: "Undo", run: () => {} } });
    interaction.contact("press", true);
    const close = open();
    const later = toast.info("Agent change B");
    close();
    expect(interaction.current?.id).toBe(page);
    interaction.contact("press", false);
    expect(interaction.current?.id).toBe(later);
  });

  it("keeps the layered snapshot while nothing in the layers changes", () => {
    open();
    toast.success("Copied");
    const before = interaction.layered;
    toast.invalidateUndo();
    expect(interaction.layered).toBe(before);
    toast.info("Agent change");
    expect(interaction.layered).not.toBe(before);
  });

  it("publishes dialog engagement changes with a stable identity between changes", () => {
    open();
    const id = toast.success("Copied");
    const idle = interaction.layered;
    interaction.contact("pointer", true, id);
    const engaged = interaction.layered;
    expect(engaged).not.toBe(idle);
    expect(engaged[0].engaged).toBe(true);
    interaction.contact("pointer", true, id);
    expect(interaction.layered).toBe(engaged);
    interaction.contact("pointer", false, id);
    expect(interaction.layered).not.toBe(engaged);
    expect(interaction.layered[0].engaged).toBe(false);
    const released = interaction.layered;
    toast.invalidateUndo();
    expect(interaction.layered).toBe(released);
  });

  it("retains a dismissed modal opener through arrivals, close and focus return", () => {
    const released = vi.fn();
    const first = notify("Open palette", { onDismiss: released });
    interaction.contact("focus", true, first);
    const opener = { closest: () => ({ dataset: { toastId: String(first) } }) } as unknown as HTMLElement;
    const close = openModalLayer(el(), { opener });
    closers.push(close);
    interaction.contact("focus", false, first);
    toast.dismiss(first);
    const next = toast.info("Arrived while palette is open");
    expect(interaction.current?.id).toBe(first);
    expect(released).not.toHaveBeenCalled();
    // The modal restores focus synchronously, before unregistering its ownership.
    interaction.contact("focus", true, first);
    close();
    expect(interaction.current?.id).toBe(first);
    expect(released).not.toHaveBeenCalled();
    interaction.contact("focus", false, first);
    expect(interaction.current?.id).toBe(next);
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("consumes a dismissed opener's action while retaining its control for focus return", () => {
    const run = vi.fn();
    const released = vi.fn();
    const id = notify("Restore clip", { action: { label: "Undo", run }, onDismiss: released });
    interaction.contact("focus", true, id);
    const opener = { closest: () => ({ dataset: { toastId: String(id) } }) } as unknown as HTMLElement;
    const close = openModalLayer(el(), { opener });
    closers.push(close);
    expect(interaction.canRunAction(id)).toBe(true);
    interaction.current!.action!.run();
    toast.dismiss(id);
    expect(interaction.current).toMatchObject({ id, actionConsumed: true });
    expect(interaction.canRunAction(id)).toBe(false);
    const next = toast.info("Discarded again");
    close();
    expect(interaction.current?.id).toBe(id);
    if (interaction.canRunAction(id)) interaction.current!.action!.run();
    expect(run).toHaveBeenCalledTimes(1);
    expect(released).not.toHaveBeenCalled();
    interaction.contact("focus", false, id);
    expect(interaction.current?.id).toBe(next);
    expect(released).toHaveBeenCalledTimes(1);
  });

  for (const contact of ["pointer", "focus", "press"] as const) {
    it(`holds engaged feedback during ${contact}; the latest waits, then follows the release`, () => {
      open();
      const first = toast.success("First copy");
      interaction.contact(contact, true, first);
      expect(interaction.engagedFor(first)).toBe(true);
      expect(interaction.engaged).toBe(false);
      toast.success("Second copy");
      const last = toast.success("Third copy");
      expect(interaction.layered.map((l) => l.toast.id)).toEqual([first]);
      if (contact === "press") interaction.endPress();
      else interaction.contact(contact, false, first);
      expect(interaction.layered.map((l) => l.toast.id)).toEqual([last]);
    });
  }

  it("dismissing engaged feedback shows the one waiting; a page dismissal of all clears the layer too", () => {
    open();
    const first = toast.success("First");
    interaction.contact("focus", true, first);
    const second = toast.success("Second");
    toast.dismiss(first);
    expect(interaction.layered.map((l) => l.toast.id)).toEqual([second]);
    expect(interaction.engagedFor(second)).toBe(false);
    toast.dismiss();
    expect(interaction.layered).toEqual([]);
  });

  it("feedback in an inner dialog belongs to it; the outer dialog keeps its own", () => {
    const outer = open();
    const a = toast.success("Outer");
    const inner = open();
    const b = toast.success("Inner");
    expect(interaction.layered.map((l) => l.toast.id)).toEqual([a, b]);
    inner();
    expect(interaction.layered.map((l) => l.toast.id)).toEqual([a]);
    outer();
    expect(interaction.layered).toEqual([]);
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
        expect(interaction.current).toMatchObject({ id, undoUnavailable: false });
        expect(interaction.canRunAction(id)).toBe(merged);
        interaction.current!.action!.run();
        expect(run).toHaveBeenCalledTimes(merged ? 1 : 0);
      } finally {
        unbind();
      }
    });
  }
});
