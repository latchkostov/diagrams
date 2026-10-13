// Run simulations from Ctrl+K and the canvas right-click (src/editor/builtinActions.ts), as the Checks card's link
// does: the editing canvas's runs, set while checks apply there (useChecks), never in live view, presenting, embeds
// or read-only views. A module of its own, so the actions don't import the run controller (and, through it, the
// checks): the Interactive HTML viewer bundles the actions with useChecks stubbed, and never sets this.

/** What the actions need of SimulationRuns. */
export interface EditingRuns {
  isRunning(): boolean;
  start(): void;
  /** True if a run was playing. */
  stop(): boolean;
}

let editing: EditingRuns | null = null;

export const editingRuns = (): EditingRuns | null => editing;

/** Sets the editing canvas's runs; with `was`, clears them only if they're still those. */
export function setEditingRuns(runs: EditingRuns | null, was?: EditingRuns) {
  if (!was || editing === was) editing = runs;
}
