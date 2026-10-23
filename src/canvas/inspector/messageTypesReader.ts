import { cachedMessageTypesAt, sameMessageRouting, type MessageTypes } from "../../model/messageTypes";
import type { DiagramFile } from "../../model/types";
import { createCheckScheduler, type SchedulerOptions } from "../checks/scheduler";

/** A lazy reader: edits only queue work, and subscribers keep the previous result until idle analysis finishes. */
export function createMessageTypesReader(options?: SchedulerOptions) {
  let pending: DiagramFile | undefined;
  let analyzed: DiagramFile | undefined;
  let result: MessageTypes | undefined;
  const listeners = new Set<() => void>();
  const current = (diagram: DiagramFile) => !!analyzed && sameMessageRouting(analyzed, diagram);
  const scheduler = createCheckScheduler(async () => {
    if (!pending) return;
    const diagram = pending;
    const next = cachedMessageTypesAt(diagram);
    analyzed = diagram;
    if (result === next) return;
    result = next;
    for (const listener of listeners) listener();
  }, options);
  return {
    get: () => result,
    current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(diagram: DiagramFile, paused = false) {
      scheduler.cancel();
      pending = diagram;
      if (!paused && !current(diagram)) scheduler.schedule();
    },
    cancel: () => scheduler.cancel(),
  };
}
