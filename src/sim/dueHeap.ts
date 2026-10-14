/** Stable arrival scheduling. Idle ticks inspect only the earliest trip. Arrays survive structuredClone. */
export interface Due {
  end: number;
  id: number;
}
const before = (a: Due, b: Due) => a.end < b.end || (a.end === b.end && a.id < b.id);
export function pushDue<T extends Due>(heap: T[], item: T): void {
  let index = heap.length;
  heap.push(item);
  while (index > 0) {
    const parent = (index - 1) >>> 1;
    if (!before(item, heap[parent])) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = item;
}
export function popDue<T extends Due>(heap: T[]): T {
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
      if (!before(heap[child], last)) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
  }
  return first;
}
