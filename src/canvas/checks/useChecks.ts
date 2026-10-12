import { useEffect, useState, useSyncExternalStore } from "react";
import type { DiagramFile } from "../../model/types";
import type { CheckResult, Finding } from "../../checks/types";
import { createCheckScheduler, type CheckScheduler } from "./scheduler";
import { runChecksOffThread } from "./runner";

// The canvas's checks: re-run after edits pause, in idle time, off the main thread (runner.ts). The first
// run waits for the canvas to settle. Diagrams over 1,500 nodes are checked only while the Checks card is
// open (docs/research/architecture-checks.md, "When").

export const FIRST_RUN_DELAY = 1200;
export const BIG_DIAGRAM = 1500;

export interface ChecksState {
  /** The newest result, or null before the first run (and where checks don't run). */
  result: CheckResult | null;
  warnings: number;
  /** Shown findings by element id (node, edge), in the result's order. */
  byElement: ReadonlyMap<string, Finding[]>;
}

const EMPTY: ChecksState = { result: null, warnings: 0, byElement: new Map() };

export function summarizeResult(result: CheckResult | null): ChecksState {
  if (!result) return EMPTY;
  const byElement = new Map<string, Finding[]>();
  for (const f of result.findings)
    for (const id of new Set(f.elements)) {
      const list = byElement.get(id);
      if (list) list.push(f);
      else byElement.set(id, [f]);
    }
  return { result, warnings: result.findings.filter((f) => f.severity === "warning").length, byElement };
}

/**
 * The canvas's checks, outside React state: the canvas itself never re-renders for a result or a hovered row.
 * Only what shows them subscribes (the count, the card, the markers, the inspector's row). A result equal to the
 * last one notifies nobody.
 */
export class ChecksStore {
  private state: ChecksState = EMPTY;
  private json = "null";
  private hot: string | null = null;
  private enabled = true;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  /** What shows: nothing while checks are off (live view, presenting). */
  readonly get = (): ChecksState => (this.enabled ? this.state : EMPTY);
  readonly getHot = (): string | null => this.hot;

  set(result: CheckResult | null) {
    const json = JSON.stringify(result);
    if (json === this.json) return;
    this.json = json;
    this.state = summarizeResult(result);
    this.emit();
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.emit();
  }

  /** The finding whose row is hovered or focused: its markers stand out. */
  readonly setHot = (id: string | null) => {
    if (id === this.hot) return;
    this.hot = id;
    this.emit();
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

/** The checks' current state, re-rendering the caller when it changes. */
export function useChecksState(store: ChecksStore): ChecksState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** The hovered finding, for the markers. */
export function useHotFinding(store: ChecksStore): string | null {
  return useSyncExternalStore(store.subscribe, store.getHot, store.getHot);
}

/**
 * Runs the checks for the canvas into a store. `revision` changes whenever the diagram does (the canvas passes
 * its nodes, edges and meta); `read` builds the file at run time, so a burst of edits costs one read, after it.
 */
export function useChecks(opts: {
  enabled: boolean;
  revision: unknown;
  read: () => DiagramFile;
  nodeCount: number;
  cardOpen: boolean;
}): ChecksStore {
  const { enabled, revision, nodeCount, cardOpen } = opts;
  const [store] = useState(() => new ChecksStore());
  const [runs] = useState(() => new CheckRuns((r) => store.set(r)));
  useEffect(() => runs.setRead(opts.read));
  useEffect(() => store.setEnabled(enabled), [enabled, store]);
  const active = enabled && (nodeCount <= BIG_DIAGRAM || cardOpen);
  useEffect(() => {
    if (active) runs.changed();
  }, [active, revision, runs]);
  // Leaving (live view, presenting, unmounting) cancels what's waiting and drops what's in flight.
  useEffect(() => {
    if (active) return () => runs.stop();
  }, [active, runs]);
  // Opening the card on a big diagram checks it at once.
  useEffect(() => {
    if (active && cardOpen && nodeCount > BIG_DIAGRAM) runs.now();
  }, [active, cardOpen, nodeCount, runs]);
  return store;
}

/** The runs behind useChecks: the scheduler, what to read, and which results are still wanted. */
export class CheckRuns {
  private read: () => DiagramFile = () => ({ format: "diagrams/v1", title: "", nodes: [], edges: [] });
  private generation = 0;
  private first = true;
  private readonly scheduler: CheckScheduler;

  constructor(
    deliver: (result: CheckResult | null) => void,
    run: (d: DiagramFile) => Promise<CheckResult> = runChecksOffThread,
    scheduler?: (task: () => Promise<void>) => CheckScheduler,
  ) {
    const task = async () => {
      const gen = this.generation;
      const diagram = this.read();
      const next = diagram.nodes.length ? await run(diagram) : null;
      // A result for a diagram that has since been replaced (another one opened, checks off) is dropped; one
      // for an older edit of this diagram still shows until the newer run lands.
      if (gen === this.generation) deliver(next);
    };
    this.scheduler = scheduler ? scheduler(task) : createCheckScheduler(task);
  }

  setRead(read: () => DiagramFile) {
    this.read = read;
  }

  /** The diagram changed: run once edits pause (the first run waits for the canvas to settle). */
  changed() {
    this.scheduler.schedule(this.first ? FIRST_RUN_DELAY : undefined);
    this.first = false;
  }

  now() {
    this.scheduler.now();
  }

  stop() {
    this.generation++;
    this.scheduler.cancel();
  }
}
