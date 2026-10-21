import type { ReactFlowState } from "@xyflow/react";

/** One forced handle-measurement batch per canvas frame, using already-known node elements. */
const queues = new WeakMap<object, Map<string, HTMLDivElement>>();
const pendingBatches = new Set<Promise<void>>();

/** Resolves after all queued React Flow handle measurements have updated their stores. */
export async function whenShapeMeasurementsReady() {
  while (pendingBatches.size) await Promise.all(pendingBatches);
}
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
    let done!: () => void;
    const completion = new Promise<void>((resolve) => {
      done = resolve;
    });
    pendingBatches.add(completion);
    requestAnimationFrame(() => {
      queues.delete(store);
      store
        .getState()
        .updateNodeInternals(new Map([...batch].map(([id, nodeElement]) => [id, { id, nodeElement, force: true }])));
      pendingBatches.delete(completion);
      done();
    });
  }
  pending.set(id, nodeElement);
}
