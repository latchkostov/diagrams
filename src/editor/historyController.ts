// The canvas's undo history and the selection each step starts from, outside React: useHistory drives it from
// renders and timers, and the tests drive it the same way, renders and batching included.
import { commit, commitReplacement, createHistory, present } from "./history";
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

  constructor(state: CanvasSnapshot, at: number) {
    this.history = createHistory(snapshotKey(state), state, at);
    this.settled = selectionOf(state);
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
    this.history = commit(prev, { key: snapshotKey(state), value: state, mergeKey, at, start: this.settled });
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
    this.history = commitReplacement(
      this.history,
      { key: snapshotKey(current), value: current, mergeKey: pendingMergeKey, at, start: this.settled },
      { key: snapshotKey(next), value: next, mergeKey, at, start: selection },
    );
    this.settled = selectionOf(next);
  }

  /** Undo or Redo with the canvas's `current` selection: the snapshot to show, or null at either end. */
  step(direction: "undo" | "redo", current: FlowSelection): CanvasSnapshot | null {
    const step = stepWithSelection(this.history, direction, current);
    if (!step) return null;
    this.history = step.history;
    this.settled = selectionOf(step.snapshot);
    return step.snapshot;
  }
}
