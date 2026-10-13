import { useEffect, useState, useSyncExternalStore } from "react";
import type { DiagramFile } from "../../model/types";
import type { CheckResult, Finding } from "../../checks/types";
import { createCheckScheduler, type CheckScheduler } from "./scheduler";
import { runChecksOffThread } from "./runner";
import { NO_EVIDENCE, SimulationRuns, type EvidenceSink, type EvidenceView, type SimContent } from "./simulationRuns";

// The canvas's checks: re-run after edits pause, in idle time, off the main thread (runner.ts). The first
// run waits for the canvas to settle. Diagrams over 1,500 nodes are checked only while the Checks card is
// open (docs/research/architecture-checks.md, "When").

export const FIRST_RUN_DELAY = 1200;
export const BIG_DIAGRAM = 1500;

/** What a finished check of an empty diagram says: it ran, and there's nothing to check. */
export const NOTHING_TO_CHECK: CheckResult = { findings: [], ignored: [], off: [], ran: [] };

export interface ChecksState {
  /** The newest result, or null before the first run finishes (and where checks don't run). */
  result: CheckResult | null;
  /**
   * The diagram has changed since `result` was worked out: its fixes wait for the next result (a fix is never
   * applied from a stale finding, nor twice).
   */
  stale: boolean;
  warnings: number;
  /** Shown findings by element id (node, edge), in the result's order. */
  byElement: ReadonlyMap<string, Finding[]>;
  /** A node's or connection's name as of the checked diagram (one index per result, never a full rebuild). */
  name(id: string): string | undefined;
  /** Run simulations: whether there are any, the run in flight, or what the last one found. */
  evidence: EvidenceView;
}

const noName = () => undefined;
const EMPTY: ChecksState = {
  result: null,
  stale: false,
  warnings: 0,
  byElement: new Map(),
  name: noName,
  evidence: NO_EVIDENCE,
};

/** Names for the elements of `diagram`: a node's label, a connection's label or "From → To". */
export function elementNames(diagram: DiagramFile | undefined): (id: string) => string | undefined {
  if (!diagram) return noName;
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n.label.trim() || n.id]));
  const edges = new Map(diagram.edges.map((e) => [e.id, e]));
  return (id) => {
    const node = nodes.get(id);
    if (node !== undefined) return node;
    const e = edges.get(id);
    if (!e) return undefined;
    return e.label?.trim() || `${nodes.get(e.from) ?? e.from} → ${nodes.get(e.to) ?? e.to}`;
  };
}

export function summarizeResult(result: CheckResult | null, diagram?: DiagramFile): ChecksState {
  if (!result) return EMPTY;
  const byElement = new Map<string, Finding[]>();
  for (const f of result.findings)
    for (const id of new Set(f.elements)) {
      const list = byElement.get(id);
      if (list) list.push(f);
      else byElement.set(id, [f]);
    }
  return {
    result,
    stale: false,
    warnings: result.findings.filter((f) => f.severity === "warning").length,
    byElement,
    name: elementNames(diagram),
    evidence: NO_EVIDENCE,
  };
}

type Merge = (result: CheckResult, diagram: DiagramFile | undefined) => CheckResult;

/**
 * The canvas's checks, outside React state: the canvas itself never re-renders for a result or a hovered row.
 * Only what shows them subscribes (the count, the card, the markers, the inspector's row). A result equal to the
 * last one notifies nobody (unless it ends a stale spell).
 */
export class ChecksStore implements EvidenceSink {
  private state: ChecksState = EMPTY;
  private json = "null";
  private hot: string | null = null;
  private enabled = true;
  private readonly listeners = new Set<() => void>();
  /** The checks' own result and the diagram it's for; what shows adds the simulations' evidence to it. */
  private checked: { result: CheckResult | null; diagram?: DiagramFile } = { result: null };
  private evidence: EvidenceView = NO_EVIDENCE;
  private merge: Merge | undefined;
  /** Run simulations: its runs report here. */
  readonly simulations: SimulationRuns = new SimulationRuns(this);

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  /** What shows: nothing while checks are off (live view, presenting). */
  readonly get = (): ChecksState => (this.enabled ? this.state : EMPTY);
  readonly getHot = (): string | null => this.hot;

  set(result: CheckResult | null, diagram?: DiagramFile) {
    const json = JSON.stringify(result);
    if (json === this.json && !this.state.stale) return;
    this.json = json;
    this.checked = { result, diagram };
    this.rebuild(false);
  }

  /** What Run simulations has to show, and how to put its counts on a result (none while they're stale). */
  setEvidence(view: EvidenceView, merge?: Merge) {
    this.evidence = view;
    if (merge === this.merge) {
      // Progress ("Playing 2 of 5…"): the findings are as they were, so nothing is merged or indexed again.
      this.state = { ...this.state, evidence: view };
      this.emit();
      return;
    }
    this.merge = merge;
    this.rebuild(this.state.stale);
  }

  /** Plays the saved simulations (the card's Run simulations). */
  readonly runSimulations = () => this.simulations.start();
  /** Stops a run in flight: true if there was one. */
  readonly stopSimulations = (): boolean => this.simulations.stop();

  private rebuild(stale: boolean) {
    const { result, diagram } = this.checked;
    const shown = result && this.merge ? this.merge(result, diagram) : result;
    this.state = { ...summarizeResult(shown, diagram), stale: !!shown && stale, evidence: this.evidence };
    this.emit();
  }

  /** The diagram changed (or a fix was just applied): the findings shown wait for the next result. */
  readonly markStale = () => {
    if (this.state.stale || !this.state.result) return;
    this.state = { ...this.state, stale: true };
    this.emit();
  };

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
  /** What a simulation plays: an edit to it stops Run simulations and hides its counts. */
  content: SimContent;
}): ChecksStore {
  const { enabled, revision, nodeCount, cardOpen, content } = opts;
  const [store] = useState(() => new ChecksStore());
  const [runs] = useState(() => new CheckRuns((r, d) => store.set(r, d)));
  const sims = store.simulations;
  useEffect(() => runs.setRead(opts.read));
  useEffect(() => sims.setRead(opts.read));
  useEffect(() => sims.setContent(content), [content, sims]);
  // Leaving editing (live view, presenting) or the canvas stops a run of the simulations.
  useEffect(() => {
    if (enabled) return () => void sims.stop();
  }, [enabled, sims]);
  useEffect(() => store.setEnabled(enabled), [enabled, store]);
  const active = enabled && (nodeCount <= BIG_DIAGRAM || cardOpen);
  useEffect(() => {
    if (!active) return;
    store.markStale();
    runs.changed();
  }, [active, revision, runs, store]);
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

/**
 * Counts of the canvas's check runs (started on the main thread, finished with a result), and a switch that
 * holds them. Development and e2e builds put them on `window.__checks`, so a test can prove checks ran while it
 * measured, and compare the same typing with them held.
 */
export const checkRunStats = { started: 0, finished: 0, held: false };
if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && typeof window !== "undefined")
  (window as unknown as { __checks: typeof checkRunStats }).__checks = checkRunStats;

/** The runs behind useChecks: the scheduler, what to read, and which results are still wanted. */
export class CheckRuns {
  private read: () => DiagramFile = () => ({ format: "diagrams/v1", title: "", nodes: [], edges: [] });
  private generation = 0;
  private first = true;
  private readonly scheduler: CheckScheduler;

  constructor(
    deliver: (result: CheckResult, diagram: DiagramFile) => void,
    run: (d: DiagramFile) => Promise<CheckResult> = runChecksOffThread,
    scheduler?: (task: () => Promise<void>) => CheckScheduler,
  ) {
    const task = async () => {
      if (checkRunStats.held) return;
      const gen = this.generation;
      const diagram = this.read();
      checkRunStats.started++;
      // An empty diagram has nothing to check: that's a finished check, not one still running.
      const next = diagram.nodes.length ? await run(diagram) : NOTHING_TO_CHECK;
      checkRunStats.finished++;
      // A result for a diagram that has since been replaced (another one opened, checks off) is dropped; one
      // for an older edit of this diagram still shows (marked stale) until the newer run lands.
      if (gen === this.generation) deliver(next, diagram);
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
