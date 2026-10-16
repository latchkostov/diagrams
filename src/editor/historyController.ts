// The canvas's undo history and the selection each step starts from, outside React: useHistory drives it from
// renders and timers, and the tests drive it the same way, renders and batching included.
import { commit, commitReplacement, createHistory, present, MERGE_WINDOW_MS } from "./history";
import type { EditorRoom } from "./room";
import {
  selectionOf,
  snapshotKey,
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
  private sequence = 0;
  private roomCoalescingBroken = false;

  constructor(
    state: CanvasSnapshot,
    at: number,
    private readonly room?: EditorRoom,
  ) {
    this.history = createHistory(snapshotKey(state), state, at);
    this.settled = selectionOf(state);
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
  observe(state: CanvasSnapshot, key = snapshotKey(state)) {
    if (key === present(this.history).key) this.settled = selectionOf(state);
  }

  /**
   * Records `state` (the canvas now) as a step, or merges it into the present one under `mergeKey`. It starts
   * from the settled selection; afterwards the canvas matches the present step, so `state`'s selection is the
   * next one's start. Returns whether the history changed.
   */
  commit(state: CanvasSnapshot, mergeKey: string | undefined, at: number): boolean {
    const prev = this.history;
    const key = snapshotKey(state);
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
      this.roomStep = { mergeKey, at, tag: merge ? last.tag : `room-step:${++this.sequence}` };
      this.roomCoalescingBroken = false;
      // A room keeps only a baseline here; Undo belongs to the scoped driver, never to snapshots.
      this.receive(state, at);
      this.room.commit(state, this.roomStep.tag);
      return true;
    }
    this.history = commit(prev, { key, value: state, mergeKey, at, start: this.settled }, undefined, this.transaction);
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
      { key: snapshotKey(current), value: current, mergeKey: pendingMergeKey, at, start: this.settled },
      { key: snapshotKey(next), value: next, mergeKey, at, start: selection },
    );
    this.settled = selectionOf(next);
  }

  /** Remote baseline: preserves an open naming transaction and never creates an undo entry. */
  receive(state: CanvasSnapshot, at = 0) {
    this.history = createHistory(snapshotKey(state), state, at);
    this.settled = selectionOf(state);
  }

  top(): string | undefined {
    return this.room ? (this.room.canUndo ? this.roomStep?.mergeKey : undefined) : present(this.history).mergeKey;
  }

  /** A system-assigned copy name is not an edit: keep step tags, selections and redo intact. */
  renameTitle(from: string, to: string) {
    this.history = {
      ...this.history,
      entries: this.history.entries.map((entry) => {
        if (entry.value.meta.title !== from) return entry;
        const value = { ...entry.value, meta: { ...entry.value.meta, title: to } };
        return { ...entry, value, key: snapshotKey(value) };
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
