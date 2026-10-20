/** One forced handle-measurement batch per canvas frame, independent of shape count. */
export function createMeasurementQueue(
  update: (ids: string[]) => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  const pending = new Set<string>();
  let scheduled = false;
  return (id: string) => {
    pending.add(id);
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      const ids = [...pending];
      pending.clear();
      update(ids);
    });
  };
}

const queues = new WeakMap<object, ReturnType<typeof createMeasurementQueue>>();
export function queueShapeMeasurement(store: object, update: (ids: string[]) => void, id: string) {
  let queue = queues.get(store);
  if (!queue) queues.set(store, (queue = createMeasurementQueue(update)));
  queue(id);
}
