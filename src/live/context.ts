import { createContext, useContext, useSyncExternalStore } from "react";
import type { DiagramFile, Simulation } from "../model/types";
import type { LiveController, LiveState } from "./controller";

/** What the live view's components share: the controller plus the session's UI commands. */
export interface LiveUi {
  controller: LiveController;
  presenting: boolean;
  /** False in the Lab (no editor: no authoring, no saving). */
  canEdit: boolean;
  diagram(): DiagramFile;
  simulations: readonly Simulation[];
  /** The unsaved simulation being authored (a storm, "New simulation"), if any. */
  draft: Simulation | null;
  selectSimulation(id: string | null): void;
  openPanel(sim?: Simulation): void;
  panelOpen: boolean;
  /** The Inputs & capacity panel. */
  capacityOpen: boolean;
  openCapacity(open?: boolean): void;
  events: { open: boolean; nodeId: string | null };
  showEvents(nodeId: string | null, open?: boolean): void;
  notice: string | null;
  /** Leave live mode; null where live is always on (Lab stages). */
  exit: (() => void) | null;
  /** "Record video…": the setup dialog, then the share prompt, countdown and recording. */
  openRecord(): void;
}

export const LiveContext = createContext<LiveUi | null>(null);

export function useLive(): LiveUi {
  const ui = useContext(LiveContext);
  if (!ui) throw new Error("useLive outside the live view");
  return ui;
}

/** The controller's published state (re-renders at the UI clock, ~8 Hz while playing). */
export function useLiveState(controller: LiveController): LiveState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}
