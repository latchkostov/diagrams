import type { DiagramFile } from "../../model/types";
import type { CheckResult } from "../../checks/types";
import type { Evidence, PlannedLoss, PlayedSimulation } from "../../checks/evidence";
import type { EvidenceProgress, EvidenceRun } from "../../checks/evidenceClient";
import type { DiagramFlowEdge, FlowNode } from "../types";

// Run simulations, for the Checks card (docs/research/architecture-checks.md, batch 5): on a click, the diagram's
// saved simulations play headless in a worker (src/checks/evidenceClient.ts, a lazy chunk) and their counts go on
// the findings. Only on demand, one run at a time, and stopped at once by Stop or Esc, by closing the card or
// leaving editing, and by any edit a simulation would see. The counts stay in memory, never in the file: they are
// worked out again the same from the file, and they go stale (hidden) as soon as the diagram changes, coming back
// if Undo brings back what they were worked out on.

/** The canvas's state, as far as a simulation sees it. */
export interface SimContent {
  nodes: readonly FlowNode[];
  edges: readonly DiagramFlowEdge[];
  meta: { simulations?: readonly unknown[] };
}

/**
 * What a simulation plays, as references: every node's and connection's data (stencil, label, props, ends) and the
 * simulations. Positions, sizes, boundaries, annotations and the selection aren't in it, so moving or selecting
 * things changes nothing, while any edit to what plays does. A walk over the arrays, no copies; the state Undo brings
 * back has the very same references.
 */
export function basisOf(c: SimContent): unknown[] {
  const out: unknown[] = [c.meta.simulations];
  for (const n of c.nodes) if (n.type === "diagram") out.push(n.id, n.data);
  out.push(null);
  for (const e of c.edges) out.push(e.id, e.source, e.target, e.data);
  return out;
}

/** Whether `c` is what `basis` was taken from, as a simulation sees it (no copy made: it runs on every change). */
export function matchesBasis(basis: readonly unknown[], c: SimContent): boolean {
  let i = 0;
  const next = (v: unknown) => i < basis.length && basis[i++] === v;
  if (!next(c.meta.simulations)) return false;
  for (const n of c.nodes) if (n.type === "diagram" && !(next(n.id) && next(n.data))) return false;
  if (!next(null)) return false;
  for (const e of c.edges) if (!(next(e.id) && next(e.source) && next(e.target) && next(e.data))) return false;
  return i === basis.length;
}

/** What the card shows about simulations. */
export type EvidenceView =
  /** The diagram has no saved simulations: no Run simulations. */
  | { status: "none" }
  /** Ready to run; `stopped` says why the last run ended early. */
  | { status: "ready"; simulations: number; stopped?: "edit" | "stop" | "failed" }
  | { status: "running"; index: number; total: number; title: string }
  | {
      status: "done";
      played: PlayedSimulation[];
      unplayed: string[];
      planned: PlannedLoss[];
      /** Findings with counts on them, `dropped` included. */
      counted: number;
      /** The diagram has changed since: the counts are hidden until it's back (Undo) or they run again. */
      stale: boolean;
    };

export const NO_EVIDENCE: EvidenceView = { status: "none" };

type Client = typeof import("../../checks/evidenceClient");
const loadClient = (): Promise<Client> => import("../../checks/evidenceClient");

/**
 * Counts of runs started, finished and stopped. Development and e2e builds put them on `window.__simulations`, so a
 * test can see a run was in flight while it measured typing.
 */
export const simulationRunStats = { started: 0, finished: 0, stopped: 0 };
if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && typeof window !== "undefined")
  (window as unknown as { __simulations: typeof simulationRunStats }).__simulations = simulationRunStats;

/** Where the runs' results go: the canvas's checks store. */
export interface EvidenceSink {
  setEvidence(view: EvidenceView, merge?: (result: CheckResult, diagram: DiagramFile | undefined) => CheckResult): void;
}

export class SimulationRuns {
  private read: () => DiagramFile = () => ({ format: "diagrams/v1", title: "", nodes: [], edges: [] });
  private content: SimContent | null = null;
  /** The content the run in flight, or the evidence shown, is about. */
  private basis: unknown[] | null = null;
  private run: EvidenceRun | null = null;
  private evidence: { data: Evidence; client: Client } | null = null;
  private view: EvidenceView = NO_EVIDENCE;
  private stopped: "edit" | "stop" | "failed" | undefined;

  constructor(
    private readonly sink: EvidenceSink,
    private readonly load: () => Promise<Client> = loadClient,
  ) {}

  setRead(read: () => DiagramFile) {
    this.read = read;
  }

  private simulations = () => this.content?.meta.simulations?.length ?? 0;

  /** The canvas changed. An edit a simulation would see stops a run, and hides counts until Undo brings it back. */
  setContent(content: SimContent) {
    this.content = content;
    const same = this.basis ? matchesBasis(this.basis, content) : true;
    if (this.run) {
      if (!same) this.stop("edit");
      return;
    }
    // Most changes (a drag, a selection, a keystroke in a label already stale) change nothing shown: say nothing.
    const v = this.view;
    const unchanged =
      v.status === "done"
        ? v.stale === !same
        : this.simulations() === (v.status === "ready" ? v.simulations : 0) && !this.evidence;
    if (!unchanged) this.publish(!same);
  }

  isRunning = () => this.run !== null;

  /** Plays the saved simulations (a run in flight is replaced). */
  start() {
    this.cancel();
    const diagram = this.read();
    if (!diagram.simulations?.length) return;
    this.basis = this.content ? basisOf(this.content) : null;
    this.evidence = null;
    this.stopped = undefined;
    simulationRunStats.started++;
    const total = diagram.simulations.length;
    this.show({ status: "running", index: 1, total, title: diagram.simulations[0].title });
    let run: EvidenceRun | null = null;
    // Stopped before the client loaded: nothing starts.
    const pending = {
      done: Promise.resolve(null as never),
      cancel: () => {
        run?.cancel();
        pending.cancelled = true;
      },
      cancelled: false,
    };
    this.run = pending;
    void this.load().then(
      (client) => {
        if (pending.cancelled || this.run !== pending) return;
        run = client.playSimulations(diagram, (p: EvidenceProgress) => {
          if (this.run === pending) this.show({ status: "running", ...p });
        });
        run.done.then(
          (data) => {
            if (this.run !== pending) return;
            this.run = null;
            simulationRunStats.finished++;
            this.evidence = { data, client };
            this.publish(false);
          },
          (err: Error) => {
            if (this.run !== pending || err.name === "EvidenceStopped") return;
            this.run = null;
            this.stopped = "failed";
            this.publish(false);
          },
        );
      },
      () => {
        if (this.run !== pending) return;
        this.run = null;
        this.stopped = "failed";
        this.publish(false);
      },
    );
  }

  /** Stops a run in flight; true if there was one (Esc stops it before it closes the card). */
  stop(why: "edit" | "stop" = "stop"): boolean {
    if (!this.run) return false;
    this.cancel();
    simulationRunStats.stopped++;
    this.stopped = why;
    this.basis = null;
    this.publish(false);
    return true;
  }

  private cancel() {
    const run = this.run;
    this.run = null;
    run?.cancel();
  }

  private publish(stale: boolean) {
    const count = this.simulations();
    const ev = this.evidence;
    if (ev && (count || stale)) {
      const { data, client } = ev;
      const counted = Object.keys(data.byFinding).length + data.findings.length;
      this.view = {
        status: "done",
        played: data.played,
        unplayed: data.unplayed,
        planned: data.planned,
        counted,
        stale,
      };
      this.sink.setEvidence(
        this.view,
        stale ? undefined : (result, diagram) => client.withEvidence(result, data, diagram?.checks),
      );
      return;
    }
    this.view = count
      ? { status: "ready", simulations: count, ...(this.stopped ? { stopped: this.stopped } : {}) }
      : NO_EVIDENCE;
    this.sink.setEvidence(this.view);
  }

  private show(view: EvidenceView) {
    this.view = view;
    this.sink.setEvidence(view);
  }
}
