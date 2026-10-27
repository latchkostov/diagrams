// The canvas's undo history and the selection each step starts from, outside React: useHistory drives it from
// renders and timers, and the tests drive it the same way, renders and batching included.
import { commit, commitReplacement, createHistory, merges, present, MERGE_WINDOW_MS } from "./history";
import type { EditorRoom } from "./room";
import {
  selectionOf,
  snapshotKey,
  roomSnapshotKey,
  stepWithSelection,
  type CanvasHistory,
  type FlowSelection,
} from "./historySelection";
import type { CanvasSnapshot } from "./useHistory";

export class HistoryController {
  history: CanvasHistory;
  /**
   * The selection the next step starts from: the canvas's while it matched the present step. Advanced by
   * renders that match it (`observe`) and, at once, by every transition that makes the canvas match it (a
   * flush, a replacement, Undo, Redo): a change batched right after one starts from there, with no render
   * between them to observe.
   */
  private settled: FlowSelection;
  /**
   * An open creation transaction's tag (`new:<id>`): a node just made, waiting for the name typed in its editor.
   * Commits under this tag merge into the step that made the node however long the naming takes. Any other
   * commit (an edit in between), Undo, Redo or a replacement closes it, as does `end`.
   */
  private transaction: string | undefined;
  private roomStep: { mergeKey?: string; at: number; tag: string } | undefined;
  private roomCoalescingBroken = false;
  private readonly keyOf: (state: CanvasSnapshot) => string;
  private roomBaseline?: { snapshot: CanvasSnapshot; at: number; selection: FlowSelection };
  private readonly entryIds = new WeakMap<object, object>();

  /**
   * Opaque identity of the step Undo would reverse, independent of tags and system copy names. In a room, the local
   * undo-stack item: the snapshot entry is only a baseline there, replaced by every peer's edit.
   */
  undoEntryId(): object | undefined {
    if (this.room) return this.room.undoEntryId();
    const entry = present(this.history);
    let id = this.entryIds.get(entry);
    if (!id) this.entryIds.set(entry, (id = {}));
    return id;
  }

  constructor(
    state: CanvasSnapshot,
    at: number,
    private room?: EditorRoom,
  ) {
    this.keyOf = room ? roomSnapshotKey : snapshotKey;
    this.history = createHistory(this.key(state), state, at);
    this.settled = selectionOf(state);
  }

  get collaborative(): boolean {
    return this.room !== undefined;
  }

  /** Sharing has ended: start local Undo at the last agreed canvas, before the restricted edit. */
  detachRoom() {
    if (!this.room) return;
    const baseline = this.roomBaseline ?? {
      snapshot: present(this.history).value,
      at: present(this.history).at,
      selection: this.settled,
    };
    this.room = undefined;
    this.transaction = undefined;
    this.roomStep = undefined;
    this.history = createHistory(this.key(baseline.snapshot), baseline.snapshot, baseline.at);
    this.settled = baseline.selection;
  }

  /** Opens a creation transaction under `tag` (the next commits tagged so are the node's own step). */
  begin(tag: string) {
    this.transaction = tag;
  }

  /** Closes the creation transaction `tag`, if it's the open one. */
  end(tag: string) {
    if (this.transaction === tag) this.transaction = undefined;
  }

  /** The open creation transaction's tag, if any. */
  get openTransaction(): string | undefined {
    return this.transaction;
  }

  /** The canvas rendered `state` (its `key`): while it matches the present step, its selection is settled. */
  key(state: CanvasSnapshot): string {
    return this.keyOf(state);
  }

  observe(state: CanvasSnapshot, key = this.key(state)) {
    if (key === present(this.history).key) this.settled = selectionOf(state);
  }

  /**
   * Records `state` (the canvas now) as a step, or merges it into the present one under `mergeKey`. It starts
   * from the settled selection; afterwards the canvas matches the present step, so `state`'s selection is the
   * next one's start. Returns whether the history changed.
   */
  commit(state: CanvasSnapshot, mergeKey: string | undefined, at: number): boolean {
    const prev = this.history;
    const key = this.key(state);
    // Another edit in between closes the creation: the name typed after it is a step of its own.
    if (this.transaction !== undefined && mergeKey !== this.transaction && key !== present(prev).key)
      this.transaction = undefined;
    if (this.room) {
      if (key === present(prev).key) return false;
      const last = this.roomStep;
      const merge =
        !this.roomCoalescingBroken &&
        last &&
        mergeKey !== undefined &&
        last.mergeKey === mergeKey &&
        (at - last.at <= MERGE_WINDOW_MS || mergeKey === this.transaction);
      this.roomStep = { mergeKey, at, tag: merge ? last.tag : this.room.newId("room-step") };
      this.roomCoalescingBroken = false;
      const start = this.settled;
      // A room keeps only a baseline here; Undo belongs to the scoped driver, never to snapshots.
      this.roomBaseline = { snapshot: present(prev).value, at: present(prev).at, selection: start };
      this.receive(state, at);
      try {
        this.room.commit(state, this.roomStep.tag, { mergeKey, start });
        // A deferred remote projection may have replaced the baseline during commit. Keep it.
        // Privacy detaches synchronously and restores the baseline from before this candidate.
        if (!this.room) return this.commit(state, mergeKey, at);
        return true;
      } finally {
        this.roomBaseline = undefined;
      }
    }
    const entry = { key, value: state, mergeKey, at, start: this.settled };
    const merged = merges(prev, entry, this.transaction);
    this.history = commit(prev, entry, undefined, this.transaction);
    // A merged edit is the same step: it keeps the identity an Undo toast is bound to.
    const id = merged ? this.entryIds.get(present(prev)) : undefined;
    if (id) this.entryIds.set(present(this.history), id);
    this.settled = selectionOf(state);
    return this.history !== prev;
  }

  /**
   * A document replacement (an AI turn): `current` (the canvas's document now, under its pending tag) becomes
   * a step of its own if it isn't one, then `next` its own step tagged `mergeKey`, made with `selection`
   * (what the canvas has selected now).
   */
  replace(
    current: CanvasSnapshot,
    pendingMergeKey: string | undefined,
    next: CanvasSnapshot,
    mergeKey: string | undefined,
    selection: FlowSelection,
    at: number,
  ) {
    this.transaction = undefined;
    if (this.room) {
      this.commit(current, pendingMergeKey, at);
      this.roomCoalescingBroken = true;
      this.commit(next, mergeKey, at);
      this.roomCoalescingBroken = true;
      return;
    }
    this.history = commitReplacement(
      this.history,
      { key: this.key(current), value: current, mergeKey: pendingMergeKey, at, start: this.settled },
      { key: this.key(next), value: next, mergeKey, at, start: selection },
    );
    this.settled = selectionOf(next);
  }

  /** Remote baseline: preserves an open naming transaction and never creates an undo entry. */
  receive(state: CanvasSnapshot, at = 0) {
    this.history = createHistory(this.key(state), state, at);
    this.settled = selectionOf(state);
  }

  top(): string | undefined {
    return this.room ? this.room.top() : present(this.history).mergeKey;
  }

  /** A system-assigned copy name is not an edit: keep step tags, selections and redo intact. */
  renameTitle(from: string, to: string) {
    this.history = {
      ...this.history,
      entries: this.history.entries.map((entry) => {
        if (entry.value.meta.title !== from) return entry;
        const value = { ...entry.value, meta: { ...entry.value.meta, title: to } };
        const renamed = { ...entry, value, key: this.key(value) };
        const id = this.entryIds.get(entry);
        if (id) this.entryIds.set(renamed, id);
        return renamed;
      }),
    };
  }

  /** Undo or Redo with the canvas's `current` selection: the snapshot to show, or null at either end. */
  step(direction: "undo" | "redo", current: FlowSelection): CanvasSnapshot | null {
    if (this.room) {
      this.transaction = undefined;
      this.roomStep = undefined;
      this.room[direction]();
      return null;
    }
    const step = stepWithSelection(this.history, direction, current);
    if (!step) return null;
    this.transaction = undefined;
    this.history = step.history;
    this.settled = selectionOf(step.snapshot);
    return step.snapshot;
  }
}
