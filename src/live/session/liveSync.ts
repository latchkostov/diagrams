import type { DiagramUpdate, LiveController } from "../controller";
import type { DiagramFile, Simulation } from "../../model/types";

// The live run kept in step with the editor's document: its diagram edits, and its saved simulations edited or
// removed. Both are the document's doing, not this person's: they're logged as "sync" (../controlLog.ts), so they
// never end following someone's shared run. And both wait while this person follows (the host's ops bring those
// changes, on their ticks; src/live/watchBridge.ts): what waited is reconciled, as the document is then, once
// following ends.

/** The editor's diagram into the run: prop edits patch it, structural ones restart it. */
export function syncDiagram(controller: LiveController, diagram: DiagramFile): DiagramUpdate {
  return controller.as("sync", () => controller.updateDiagram(diagram));
}

/**
 * The editor's saved simulations into the run. The selected one edited (undo, the panel's Save, Apply fix) runs
 * with its new definition, Inputs kept; removed from the list, the run goes to free play. One the list never had
 * (an unsaved draft, a draft the followed host was running) stays as it is.
 */
export function syncSimulation(
  controller: LiveController,
  simulations: readonly Simulation[],
  draftId: string | undefined,
  known: ReadonlySet<string>,
): void {
  const cur = controller.getState().simulation;
  if (!cur || cur.id === draftId) return;
  const next = simulations.find((s) => s.id === cur.id);
  if (!next) {
    if (known.has(cur.id)) controller.as("sync", () => controller.selectSimulation(null));
  } else if (JSON.stringify(next) !== JSON.stringify(cur)) controller.as("sync", () => controller.setBase(next));
}

/** The one boundary between the editor's document and the run: following-aware. */
export class LiveSync {
  #controller: LiveController;
  #reloaded: () => void;

  #following = false;
  #diagramWaits?: () => DiagramFile;
  #simulationsWait?: { simulations: readonly Simulation[]; draftId: () => string | undefined };
  readonly #known = new Set<string>();

  constructor(
    controller: LiveController,
    /** A structural edit restarted the run. */
    reloaded: () => void = () => {},
  ) {
    this.#controller = controller;
    this.#reloaded = reloaded;
  }

  /** The diagram changed in the editor (`read` gives it as it is when the run takes it). */
  diagram(read: () => DiagramFile): void {
    if (this.#following) {
      this.#diagramWaits = read;
      return;
    }
    if (syncDiagram(this.#controller, read()) === "reloaded") this.#reloaded();
  }

  /** The saved simulations changed. */
  simulations(simulations: readonly Simulation[], draftId: () => string | undefined): void {
    for (const s of simulations) this.#known.add(s.id);
    if (this.#following) {
      this.#simulationsWait = { simulations, draftId };
      return;
    }
    syncSimulation(this.#controller, simulations, draftId(), this.#known);
  }

  /** Following starts (the document's changes wait) or ends (what waited is reconciled). */
  setFollowing(on: boolean): void {
    if (on === this.#following) return;
    this.#following = on;
    if (on) return;
    const diagram = this.#diagramWaits;
    const sims = this.#simulationsWait;
    this.#diagramWaits = undefined;
    this.#simulationsWait = undefined;
    if (diagram) this.diagram(diagram);
    if (sims) this.simulations(sims.simulations, sims.draftId);
  }
}
