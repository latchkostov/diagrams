import { useCallback, useState, useSyncExternalStore } from "react";
import type { LiveController } from "./controller";
import { TroubleWatcher, pickTrouble, type Trouble, type TroubleMemory } from "./observedTrouble";
import { simulationEdges } from "../sim/simulationEdges";

/**
 * The run's trouble for the callout (src/live/observedTrouble.ts), read on every controller publication: a status
 * change shows at once, paused or not, and the watcher samples the trends about once a simulated second. Each
 * cause shows once per run (the engine's generation and the simulation), until dismissed or over. Reading never
 * counts as showing: only a callout on screen marks its cause shown (`shown`).
 */
export class TroubleTracker {
  private watcher = new TroubleWatcher();
  private run = "";
  private memory: TroubleMemory = { shown: new Set(), ended: new Set(), dismissed: new Set() };
  private troubles: readonly Trouble[] = [];
  private picked: Trouble | undefined;
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;

  constructor(private readonly controller: LiveController) {
    this.observe();
  }

  /** The trouble to show now; the same object while nothing changed (useSyncExternalStore's snapshot). */
  current = (): Trouble | undefined => this.picked;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.unsubscribe) this.unsubscribe = this.controller.subscribe(this.observe);
    // Catch any controller publication between construction/render and subscription.
    this.observe();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    };
  };

  private observe = (): void => {
    const st = this.controller.getState();
    const run = `${st.generation}:${st.simulation?.id ?? ""}`;
    if (run !== this.run) {
      this.run = run;
      this.memory = { shown: new Set(), ended: new Set(), dismissed: new Set() };
      this.watcher.reset();
    }
    const now = this.watcher.observe(
      st.snapshot,
      simulationEdges(this.controller.currentDiagram, st.running ?? undefined),
    );
    if (now !== this.troubles) {
      this.troubles = now;
      this.picked = pickTrouble(now, this.memory, this.watcher.warm);
    }
    for (const listener of this.listeners) listener();
  };

  shown(key: string): void {
    this.memory.shown.add(key);
  }

  dismiss(key: string): void {
    this.memory.dismissed.add(key);
    this.picked = pickTrouble(this.troubles, this.memory, this.watcher.warm);
    for (const listener of this.listeners) listener();
  }
}

export function useObservedTrouble(controller: LiveController): {
  trouble?: Trouble;
  dismiss: () => void;
  /** The callout is on screen with this cause: it has had its turn this run. */
  shown: (key: string) => void;
} {
  const [tracker] = useState(() => new TroubleTracker(controller));
  const trouble = useSyncExternalStore(tracker.subscribe, tracker.current);
  const dismiss = useCallback(() => {
    if (!trouble) return;
    tracker.dismiss(trouble.key);
  }, [tracker, trouble]);
  const shown = useCallback((key: string) => tracker.shown(key), [tracker]);
  return { trouble, dismiss, shown };
}
