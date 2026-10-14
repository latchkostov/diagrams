import { useCallback, useReducer, useState, useSyncExternalStore } from "react";
import type { LiveController } from "./controller";
import { TroubleWatcher, pickTrouble, type Trouble } from "./observedTrouble";

/**
 * The run's trouble for the callout (src/live/observedTrouble.ts), read on every controller publication: a status
 * change shows at once, paused or not, and the watcher samples the trends about once a simulated second. Each
 * cause shows once per run (the engine's generation and the simulation), until dismissed or over.
 */
class TroubleTracker {
  private watcher = new TroubleWatcher();
  private run = "";
  private memory = { shown: new Set<string>(), ended: new Set<string>(), dismissed: new Set<string>() };
  private troubles: readonly Trouble[] = [];
  private picked: Trouble | undefined;

  constructor(private readonly controller: LiveController) {}

  /** The trouble to show now; the same object while nothing changed (useSyncExternalStore's snapshot). */
  current = (): Trouble | undefined => {
    const st = this.controller.getState();
    const run = `${st.generation}:${st.simulation?.id ?? ""}`;
    if (run !== this.run) {
      this.run = run;
      this.memory = { shown: new Set(), ended: new Set(), dismissed: new Set() };
      this.watcher.reset();
    }
    const now = this.watcher.observe(st.snapshot, this.controller.currentDiagram);
    if (now !== this.troubles) {
      this.troubles = now;
      this.picked = pickTrouble(now, this.memory);
    }
    return this.picked;
  };

  dismiss(key: string): void {
    this.memory.dismissed.add(key);
    this.picked = pickTrouble(this.troubles, this.memory);
  }
}

export function useObservedTrouble(controller: LiveController): { trouble?: Trouble; dismiss: () => void } {
  const [tracker] = useState(() => new TroubleTracker(controller));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const trouble = useSyncExternalStore(controller.subscribe, tracker.current);
  const dismiss = useCallback(() => {
    if (!trouble) return;
    tracker.dismiss(trouble.key);
    rerender();
  }, [tracker, trouble]);
  return { trouble, dismiss };
}
