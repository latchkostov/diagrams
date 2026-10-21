import type { ReactFlowState } from "@xyflow/react";

/** One forced handle-measurement batch per canvas frame, using already-known node elements. */
const queues = new WeakMap<object, Map<string, HTMLDivElement>>();
export function queueShapeMeasurement(
  store: { getState: () => Pick<ReactFlowState, "updateNodeInternals"> },
  id: string,
  nodeElement: HTMLDivElement,
) {
  let pending = queues.get(store);
  if (!pending) {
    pending = new Map();
    queues.set(store, pending);
    const batch = pending;
    requestAnimationFrame(() => {
      queues.delete(store);
      store
        .getState()
        .updateNodeInternals(new Map([...batch].map(([id, nodeElement]) => [id, { id, nodeElement, force: true }])));
    });
  }
  pending.set(id, nodeElement);
}
